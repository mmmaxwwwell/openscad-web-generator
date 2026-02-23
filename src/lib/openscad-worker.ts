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

interface InitRequest {
  type: 'init';
  id: string;
}

export type WorkerRequest = RenderRequest | InitRequest;

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

  cachedModules = {
    OpenSCAD: openscadModule.default,
    addFonts: fontsModule.addFonts,
    addMCAD: mcadModule.addMCAD,
    addBOSL2: bosl2Module.addBOSL2,
  };
  return cachedModules;
}

/** Create a fresh WASM instance with libraries loaded. */
async function createInstance(
  onStdout: (text: string) => void,
  onStderr: (text: string) => void,
): Promise<any> {
  const { OpenSCAD, addFonts, addMCAD, addBOSL2 } = await loadModules();

  const inst = await OpenSCAD({
    noInitialRun: true,
    print: onStdout,
    printErr: onStderr,
  });

  addFonts(inst);
  addMCAD(inst);
  addBOSL2(inst);

  return inst;
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

    const onStdout = (text: string) => {
      console.log('[OpenSCAD stdout]', text);
      collectedLogs.push(text);
      self.postMessage({ type: 'log', id: req.id, logs: [text] } satisfies LogResponse);
    };

    const onStderr = (text: string) => {
      console.warn('[OpenSCAD stderr]', text);
      const line = `[stderr] ${text}`;
      collectedLogs.push(line);
      self.postMessage({ type: 'log', id: req.id, logs: [line] } satisfies LogResponse);
    };

    try {
      // Create a fresh instance for each render — callMain + exit() leaves
      // the Emscripten runtime unusable for subsequent calls.
      const inst = await createInstance(onStdout, onStderr);

      const inputPath = '/input.scad';
      const ext = req.outputFormat;
      const outputPath = `/output.${ext}`;

      inst.FS.writeFile(inputPath, req.scadSource);

      // Ensure /libraries exists (some WASM builds don't create it)
      try { inst.FS.mkdir('/libraries'); } catch (_) { /* already exists */ }

      // Log FS state for debugging
      try {
        const root = inst.FS.readdir('/');
        console.log('[OpenSCAD worker] FS root:', root);
        const libs = inst.FS.readdir('/libraries');
        console.log('[OpenSCAD worker] /libraries:', libs);
      } catch (fsErr: any) {
        console.warn('[OpenSCAD worker] FS debug failed:', fsErr);
      }

      // Try minimal args first to diagnose crashes
      const args = [inputPath, '-o', outputPath];
      console.log('[OpenSCAD worker] Running with args:', args.join(' '));

      let exitCode: number;
      try {
        const ret = inst.callMain(args);
        exitCode = typeof ret === 'number' ? ret : 0;
        console.log('[OpenSCAD worker] callMain returned:', ret);
      } catch (e: any) {
        console.error('[OpenSCAD worker] callMain threw:', e, 'name:', e?.name, 'status:', e?.status, 'message:', e?.message);
        // Emscripten throws ExitStatus when OpenSCAD calls exit().
        // Extract the exit code from the exception.
        if (e?.name === 'ExitStatus') {
          exitCode = e.status ?? 0;
        } else if (e instanceof WebAssembly.RuntimeError) {
          // WASM trap (abort, unreachable, OOM) — not a normal exit
          self.postMessage({
            type: 'error',
            id: req.id,
            error: `OpenSCAD WASM crashed: ${e.message}`,
            logs: collectedLogs,
          } satisfies ErrorResponse);
          return;
        } else if (typeof e === 'number') {
          // Uncaught C++ exception — Emscripten throws the exception pointer
          // as a raw number.  This typically means a bug or unsupported feature.
          self.postMessage({
            type: 'error',
            id: req.id,
            error: `OpenSCAD crashed with an internal error (C++ exception)`,
            logs: collectedLogs,
          } satisfies ErrorResponse);
          return;
        } else {
          throw e;
        }
      }

      if (exitCode === 0) {
        let output: Uint8Array;
        try {
          output = inst.FS.readFile(outputPath) as Uint8Array;
        } catch (readErr: any) {
          console.error('[OpenSCAD worker] Failed to read output file:', readErr);
          self.postMessage({
            type: 'error',
            id: req.id,
            error: `Render succeeded but failed to read output: ${readErr?.message ?? readErr}`,
            logs: collectedLogs,
          } satisfies ErrorResponse);
          return;
        }

        // Copy into a standalone ArrayBuffer — output.buffer is the entire
        // WASM heap, which must not be transferred/detached.
        const buf = new ArrayBuffer(output.byteLength);
        new Uint8Array(buf).set(output);

        self.postMessage(
          { type: 'success', id: req.id, output: buf } satisfies SuccessResponse,
          { transfer: [buf] },
        );
      } else {
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
      }
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
};
