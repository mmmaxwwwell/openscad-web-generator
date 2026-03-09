/**
 * Web Worker that loads and runs OpenSCAD WASM.
 *
 * Communication is via postMessage:
 *   Main thread sends: WorkerRequest
 *   Worker responds:   WorkerResponse
 *
 * Each render creates a fresh WASM instance because OpenSCAD's main()
 * calls exit(), which leaves the Emscripten runtime in an unusable state.
 * This matches how the official OpenSCAD playground handles it.
 */

type OutputFormat = 'stl' | '3mf';

interface RenderRequest {
  type: 'render';
  id: string;
  scadSource: string;
  outputFormat: OutputFormat;
  args?: string[];
}

interface MulticolorRenderRequest {
  type: 'render-multicolor';
  id: string;
  scadSource: string;
}

interface InitRequest {
  type: 'init';
  id: string;
}

export type WorkerRequest = RenderRequest | MulticolorRenderRequest | InitRequest;

interface SuccessResponse {
  type: 'success';
  id: string;
  output: ArrayBuffer;
}

interface ErrorResponse {
  type: 'error';
  id: string;
  error: string;
  logs: string[];
}

interface InitResponse {
  type: 'init';
  id: string;
  success: boolean;
  error?: string;
}

interface LogResponse {
  type: 'log';
  id: string;
  logs: string[];
}

export type WorkerResponse = SuccessResponse | ErrorResponse | InitResponse | LogResponse;

// Cache the loaded JS modules so we don't re-fetch them each time,
// but create a fresh WASM instance for every render.
let cachedModules: {
  OpenSCAD: any;
  addFonts: any;
  addMCAD: any;
  addBOSL2: any;
  addQR: any;
} | null = null;

async function loadModules() {
  if (cachedModules) return cachedModules;

  const base = self.location.origin;
  // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
  const openscadModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.js`);
  // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
  const fontsModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.fonts.js`);
  // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
  const mcadModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.mcad.js`);
  // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
  const bosl2Module = await import(/* @vite-ignore */ `${base}/wasm/openscad.bosl2.js`);
  // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
  const qrModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.qr.js`);

  cachedModules = {
    OpenSCAD: openscadModule.default,
    addFonts: fontsModule.addFonts,
    addMCAD: mcadModule.addMCAD,
    addBOSL2: bosl2Module.addBOSL2,
    addQR: qrModule.addQR,
  };
  return cachedModules;
}

/** Create a fresh WASM instance with libraries loaded. */
async function createInstance(
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
): Promise<any> {
  const { OpenSCAD, addFonts, addMCAD, addBOSL2, addQR } = await loadModules();

  const inst = await OpenSCAD({
    noInitialRun: true,
    print: onStdout,
    printErr: onStderr,
  });

  addFonts(inst);
  addMCAD(inst);
  addBOSL2(inst);
  addQR(inst);

  return inst;
}

/**
 * Run OpenSCAD on a source file and return the exit code + output file bytes.
 * Handles the ExitStatus exception pattern.
 */
async function runOpenSCAD(
  source: string,
  args: string[],
  inputPath: string,
  outputPath: string | null,
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
): Promise<{ exitCode: number; output: Uint8Array | null }> {
  const inst = await createInstance(onStdout, onStderr);
  inst.FS.writeFile(inputPath, source);
  try { inst.FS.mkdir('/libraries'); } catch (_) { /* already exists */ }

  let exitCode: number;
  try {
    const ret = inst.callMain(args);
    exitCode = typeof ret === 'number' ? ret : 0;
  } catch (e: any) {
    if (e?.name === 'ExitStatus') {
      exitCode = e.status ?? 0;
    } else if (e instanceof WebAssembly.RuntimeError) {
      throw new Error(`OpenSCAD WASM crashed: ${e.message}`);
    } else if (typeof e === 'number') {
      throw new Error('OpenSCAD crashed with an internal error (C++ exception)');
    } else {
      throw e;
    }
  }

  let output: Uint8Array | null = null;
  if (exitCode === 0 && outputPath) {
    try {
      const raw = inst.FS.readFile(outputPath) as Uint8Array;
      output = new Uint8Array(raw.byteLength);
      output.set(raw);
    } catch (readErr: any) {
      throw new Error(`Render succeeded but failed to read output: ${readErr?.message ?? readErr}`);
    }
  }

  return { exitCode, output };
}

// CSS/SVG named colors supported by OpenSCAD (subset covering common ones).
// Values are [r, g, b] in 0-1 range.
const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.502, 0],
  blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1],
  gray: [0.502, 0.502, 0.502], grey: [0.502, 0.502, 0.502],
  silver: [0.753, 0.753, 0.753], maroon: [0.502, 0, 0],
  olive: [0.502, 0.502, 0], navy: [0, 0, 0.502], purple: [0.502, 0, 0.502],
  teal: [0, 0.502, 0.502], aqua: [0, 1, 1], fuchsia: [1, 0, 1],
  orange: [1, 0.647, 0], pink: [1, 0.753, 0.796], lime: [0, 1, 0],
  brown: [0.647, 0.165, 0.165], coral: [1, 0.498, 0.314],
  gold: [1, 0.843, 0], khaki: [0.941, 0.902, 0.549],
  ivory: [1, 1, 0.941], indigo: [0.294, 0, 0.510],
  crimson: [0.863, 0.078, 0.235], tomato: [1, 0.388, 0.278],
  salmon: [0.980, 0.502, 0.447], sienna: [0.627, 0.322, 0.176],
  tan: [0.824, 0.706, 0.549], wheat: [0.961, 0.871, 0.702],
  violet: [0.933, 0.510, 0.933], turquoise: [0.251, 0.878, 0.816],
  orchid: [0.855, 0.439, 0.839], plum: [0.867, 0.627, 0.867],
  peru: [0.804, 0.522, 0.247], chocolate: [0.824, 0.412, 0.118],
  beige: [0.961, 0.961, 0.863], linen: [0.980, 0.941, 0.902],
  snow: [1, 0.980, 0.980], honeydew: [0.941, 1, 0.941],
  lavender: [0.902, 0.902, 0.980],
  darkred: [0.545, 0, 0], darkgreen: [0, 0.392, 0], darkblue: [0, 0, 0.545],
  darkgray: [0.663, 0.663, 0.663], darkgrey: [0.663, 0.663, 0.663],
  lightgray: [0.827, 0.827, 0.827], lightgrey: [0.827, 0.827, 0.827],
  lightblue: [0.678, 0.847, 0.902], lightgreen: [0.565, 0.933, 0.565],
  dimgray: [0.412, 0.412, 0.412], dimgrey: [0.412, 0.412, 0.412],
};

/**
 * Parse a color string from OpenSCAD echo output.
 * Handles both "[r, g, b, a]" array format and named CSS colors like "black".
 */
function parseColorString(s: string): [number, number, number, number] | null {
  const trimmed = s.trim().replace(/^"|"$/g, '');

  // Try named color first
  const named = NAMED_COLORS[trimmed.toLowerCase()];
  if (named) {
    return [named[0], named[1], named[2], 1];
  }

  // Try parsing as "[r, g, b, a]" array
  const nums = trimmed.replace(/[\[\]]/g, '').split(',').map(v => parseFloat(v.trim()));
  if (nums.length >= 3 && nums.every(n => !isNaN(n))) {
    return [nums[0], nums[1], nums[2], nums[3] ?? 1];
  }

  // Try hex color "#rrggbb"
  const hex = trimmed.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (hex) {
    return [parseInt(hex[1], 16) / 255, parseInt(hex[2], 16) / 255, parseInt(hex[3], 16) / 255, 1];
  }

  return null;
}

/**
 * Discover colors used in a .scad source by redefining the color() module
 * to echo its parameter, then parsing unique color values from stderr.
 */
async function discoverColors(
  scadSource: string,
  log: (text: string) => void,
): Promise<[number, number, number, number][]> {
  const stderrLines: string[] = [];
  const colorIdTag = `colorid_${Date.now()}`;

  await runOpenSCAD(
    scadSource,
    [
      '/input.scad',
      '-o', '/output.stl',
      '-D', `module color(c) {echo(${colorIdTag}=str(c));}`,
    ],
    '/input.scad',
    null, // we don't need the output file
    () => {},
    (text) => stderrLines.push(text),
  );

  // Parse ECHO lines: "ECHO: colorid_xxx = [r, g, b, a]"
  const prefix = `ECHO: ${colorIdTag} = `;
  const colorStrings = new Set<string>();
  for (const line of stderrLines) {
    if (line.startsWith(prefix)) {
      const colorStr = line.slice(prefix.length).trim();
      colorStrings.add(colorStr);
    }
  }

  // Debug: log all stderr lines and discovered color strings
  log(`Discovery stderr (${stderrLines.length} lines): ${stderrLines.slice(0, 10).join(' | ')}`);
  log(`Raw color strings: ${[...colorStrings].join(', ')}`);

  if (colorStrings.size === 0) {
    throw new Error('No colors found in model. Make sure geometry is wrapped in color() calls.');
  }

  // Parse color strings into number arrays.
  // Colors can be "[r, g, b, a]" arrays or CSS/SVG named colors like "black".
  const colors: [number, number, number, number][] = [];
  for (const s of colorStrings) {
    const rgba = parseColorString(s);
    if (rgba) {
      colors.push(rgba);
    } else {
      log(`Warning: could not parse color: ${s}`);
    }
  }

  // Sort for consistent ordering
  colors.sort((a, b) => {
    for (let i = 0; i < 4; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  });

  log(`Discovered ${colors.length} unique color(s)`);
  return colors;
}

/**
 * Render the model filtered to a single color, producing a 3MF file.
 * Uses the colorscad technique: redefine color() to only pass through
 * geometry matching the target color.
 */
async function renderSingleColor(
  scadSource: string,
  color: [number, number, number, number],
  _log: (text: string) => void,
): Promise<Uint8Array> {
  const colorStr = `[${color.join(', ')}]`;
  const collectedLogs: string[] = [];

  // The color filter module: only renders children whose color matches.
  // Compare components numerically (with tolerance) to avoid str() formatting mismatches.
  const [r, g, b, a] = color;
  const eps = 0.001;
  const colorFilter = [
    '$colored = false;',
    'module color(c) {',
    '  if ($colored) { children(); }',
    '  else {',
    '    $colored = true;',
    '    echo("COLORDEBUG", c=c, type=is_list(c) ? "list" : "other");',
    `    _c = is_list(c) ? c : [0,0,0,1];`,
    `    _ca = len(_c) > 3 ? _c[3] : 1;`,
    `    if (abs(_c[0] - ${r}) < ${eps} && abs(_c[1] - ${g}) < ${eps} && abs(_c[2] - ${b}) < ${eps} && abs(_ca - ${a}) < ${eps}) children();`,
    '  }',
    '}',
  ].join(' ');

  const { exitCode, output } = await runOpenSCAD(
    scadSource,
    ['/input.scad', '-o', '/output.stl', '-D', colorFilter],
    '/input.scad',
    '/output.stl',
    (text) => collectedLogs.push(text),
    (text) => collectedLogs.push(text),
  );

  // Debug: log filter output
  _log(`Filter logs for ${colorStr}: ${collectedLogs.join(' | ')}`);

  if (exitCode !== 0) {
    throw new Error(`Render for color ${colorStr} failed (exit code ${exitCode})`);
  }
  if (!output || output.byteLength === 0) {
    throw new Error(`Render for color ${colorStr} produced empty output (exit was ${exitCode}, ${collectedLogs.length} log lines)`);
  }

  return output;
}

// Catch unhandled errors/rejections in the worker so they aren't silent
self.addEventListener('error', (e) => {
  console.error('[OpenSCAD worker] Unhandled error:', e.message, e);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[OpenSCAD worker] Unhandled rejection:', e.reason);
});

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === 'init') {
    try {
      // Pre-load JS modules so the first render is faster
      await loadModules();
      self.postMessage({ type: 'init', id: req.id, success: true } satisfies InitResponse);
    } catch (err: any) {
      self.postMessage({
        type: 'init',
        id: req.id,
        success: false,
        error: err?.message ?? String(err),
      } satisfies InitResponse);
    }
    return;
  }

  if (req.type === 'render') {
    const collectedLogs: string[] = [];

    const sendLog = (text: string) => {
      collectedLogs.push(text);
      self.postMessage({ type: 'log', id: req.id, logs: [text] } satisfies LogResponse);
    };

    try {
      // Always render to STL via runOpenSCAD, then wrap in 3MF if needed.
      // OpenSCAD WASM's native 3MF output is missing _rels/.rels and has
      // structural issues that break both Three.js ThreeMFLoader and slicers.
      const { exitCode, output } = await runOpenSCAD(
        req.scadSource,
        ['/input.scad', '-o', '/output.stl'],
        '/input.scad',
        '/output.stl',
        (text) => {
          console.log('[OpenSCAD stdout]', text);
          sendLog(text);
        },
        (text) => {
          console.warn('[OpenSCAD stderr]', text);
          sendLog(`[stderr] ${text}`);
        },
      );

      if (exitCode !== 0 || !output) {
        console.error(`[OpenSCAD worker] Exit code: ${exitCode}, logs:`, collectedLogs);
        const errorMsg = exitCode > 255
          ? `OpenSCAD crashed (code ${exitCode}). This may be caused by high memory usage — try reducing $fn or model complexity.`
          : `OpenSCAD exited with code ${exitCode}`;
        self.postMessage({
          type: 'error',
          id: req.id,
          error: errorMsg,
          logs: collectedLogs,
        } satisfies ErrorResponse);
        return;
      }

      let finalOutput: Uint8Array;
      if (req.outputFormat === '3mf') {
        // Wrap STL in a proper 3MF archive with correct structure
        const { merge3mf } = await import('./merge-3mf');
        const defaultColor: [number, number, number, number] = [0.29, 0.56, 0.85, 1]; // #4a90d9
        finalOutput = merge3mf([{ color: defaultColor, data: output }]);
      } else {
        finalOutput = output;
      }

      const buf = new ArrayBuffer(finalOutput.byteLength);
      new Uint8Array(buf).set(finalOutput);

      self.postMessage(
        { type: 'success', id: req.id, output: buf } satisfies SuccessResponse,
        { transfer: [buf] },
      );
    } catch (err: any) {
      console.error('[OpenSCAD worker] Unexpected error:', err);
      self.postMessage({
        type: 'error',
        id: req.id,
        error: err?.message ?? String(err),
        logs: collectedLogs,
      } satisfies ErrorResponse);
    }
  }

  if (req.type === 'render-multicolor') {
    const collectedLogs: string[] = [];
    const sendLog = (text: string) => {
      collectedLogs.push(text);
      self.postMessage({ type: 'log', id: req.id, logs: [text] } satisfies LogResponse);
    };

    try {
      // Step 1: Render to .csg to resolve named colors and evaluate functions
      sendLog('Rendering to CSG (resolving colors)...');
      const { exitCode: csgExit, output: csgOutput } = await runOpenSCAD(
        req.scadSource,
        ['/input.scad', '-o', '/output.csg'],
        '/input.scad',
        '/output.csg',
        () => {},
        (text) => sendLog(`[stderr] ${text}`),
      );

      if (csgExit !== 0 || !csgOutput) {
        throw new Error(`CSG render failed (exit code ${csgExit})`);
      }

      const csgSource = new TextDecoder().decode(csgOutput);
      sendLog('CSG render complete.');

      // Debug: log first few lines of CSG to understand format
      const csgLines = csgSource.split('\n');
      sendLog(`CSG: ${csgLines.length} lines total`);
      // Log lines containing 'color' to see how colors appear in CSG
      const colorLines = csgLines.filter(l => l.toLowerCase().includes('color'));
      sendLog(`CSG color lines: ${colorLines.slice(0, 5).join(' | ')}`);

      // Step 2: Discover colors
      sendLog('Discovering colors...');
      const colors = await discoverColors(csgSource, sendLog);

      // Step 3: Render each color to 3MF
      const { merge3mf } = await import('./merge-3mf');
      const coloredModels: { color: [number, number, number, number]; data: Uint8Array }[] = [];

      for (let i = 0; i < colors.length; i++) {
        const color = colors[i];
        sendLog(`Rendering color ${i + 1}/${colors.length}: [${color.join(', ')}]`);
        const data = await renderSingleColor(csgSource, color, sendLog);
        coloredModels.push({ color, data });
      }

      // Step 4: Merge into multi-color 3MF
      sendLog('Merging into multi-color 3MF...');
      const merged = merge3mf(coloredModels);

      const buf = merged.buffer.byteLength === merged.byteLength
        ? merged.buffer as ArrayBuffer
        : merged.slice().buffer as ArrayBuffer;

      sendLog('Multi-color 3MF complete!');
      self.postMessage(
        { type: 'success', id: req.id, output: buf } satisfies SuccessResponse,
        { transfer: [buf] },
      );
    } catch (err: any) {
      console.error('[OpenSCAD worker] Multicolor render error:', err);
      self.postMessage({
        type: 'error',
        id: req.id,
        error: err?.message ?? String(err),
        logs: collectedLogs,
      } satisfies ErrorResponse);
    }
  }
};
