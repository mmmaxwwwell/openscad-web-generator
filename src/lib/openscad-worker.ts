/**
 * Web Worker that loads and runs OpenSCAD WASM.
 *
 * Communication is via postMessage:
 *   Main thread sends: WorkerRequest
 *   Worker responds:   WorkerResponse
 */

// The WASM files are served from /wasm/ in the public directory.
// openscad.js uses import.meta.url and dynamic import() internally,
// so we import it directly and let Vite handle the resolution.

type OutputFormat = 'stl' | '3mf' | 'png';

interface RenderRequest {
  type: 'render';
  id: string;
  scadSource: string;
  outputFormat: OutputFormat;
  args?: string[];
}

interface PreviewRequest {
  type: 'preview';
  id: string;
  scadSource: string;
  cameraArgs: string; // "transX,transY,transZ,rotX,rotY,rotZ,distance"
  imgSize?: [number, number];
}

interface InitRequest {
  type: 'init';
  id: string;
}

export type WorkerRequest = RenderRequest | PreviewRequest | InitRequest;

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

// Emscripten module instance (lazy-initialized)
let instance: any = null;
let initPromise: Promise<any> | null = null;

async function getInstance(): Promise<any> {
  if (instance) return instance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Load the WASM entry points from the public directory using dynamic import.
    // Construct full URLs to bypass Vite's import analysis (which blocks
    // importing JS files from /public directly).
    const base = self.location.origin;
    // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
    const openscadModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.js`);
    // @ts-ignore — runtime-resolved public assets, not statically resolvable by TS
    const fontsModule = await import(/* @vite-ignore */ `${base}/wasm/openscad.fonts.js`);
    const OpenSCAD = openscadModule.default;
    const addFonts = fontsModule.addFonts;

    const inst = await OpenSCAD({
      noInitialRun: true,
    });

    addFonts(inst);
    instance = inst;
    return inst;
  })();

  return initPromise;
}

function collectLogs(inst: any, fn: () => number): { exitCode: number; logs: string[] } {
  const logs: string[] = [];
  const origPrint = inst.print;
  const origPrintErr = inst.printErr;
  inst.print = (text: string) => logs.push(text);
  inst.printErr = (text: string) => logs.push(`[stderr] ${text}`);
  try {
    const exitCode = fn();
    return { exitCode, logs };
  } finally {
    inst.print = origPrint;
    inst.printErr = origPrintErr;
  }
}

function cleanupFile(inst: any, path: string) {
  try {
    inst.FS.unlink(path);
  } catch (_) {
    // File may not exist — that's fine
  }
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === 'init') {
    try {
      await getInstance();
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

  try {
    const inst = await getInstance();
    const inputPath = '/input.scad';

    if (req.type === 'render') {
      const ext = req.outputFormat;
      const outputPath = `/output.${ext}`;

      inst.FS.writeFile(inputPath, req.scadSource);
      cleanupFile(inst, outputPath);

      const args = [inputPath, '-o', outputPath, ...(req.args ?? [])];
      const { exitCode, logs } = collectLogs(inst, () => inst.callMain(args));

      if (exitCode === 0) {
        const output = inst.FS.readFile(outputPath) as Uint8Array;
        const buf = output.buffer as ArrayBuffer;
        self.postMessage(
          { type: 'success', id: req.id, output: buf } satisfies SuccessResponse,
          { transfer: [buf] },
        );
      } else {
        self.postMessage({
          type: 'error',
          id: req.id,
          error: `OpenSCAD exited with code ${exitCode}`,
          logs,
        } satisfies ErrorResponse);
      }
    } else if (req.type === 'preview') {
      const outputPath = '/preview.png';
      const [w, h] = req.imgSize ?? [512, 512];

      inst.FS.writeFile(inputPath, req.scadSource);
      cleanupFile(inst, outputPath);

      const args = [
        inputPath,
        '-o', outputPath,
        '--camera', req.cameraArgs,
        '--imgsize', `${w},${h}`,
        '--projection', 'p',
        '--autocenter',
      ];

      const { exitCode, logs } = collectLogs(inst, () => inst.callMain(args));

      if (exitCode === 0) {
        const output = inst.FS.readFile(outputPath) as Uint8Array;
        const buf = output.buffer as ArrayBuffer;
        self.postMessage(
          { type: 'success', id: req.id, output: buf } satisfies SuccessResponse,
          { transfer: [buf] },
        );
      } else {
        self.postMessage({
          type: 'error',
          id: req.id,
          error: `OpenSCAD preview failed with code ${exitCode}`,
          logs,
        } satisfies ErrorResponse);
      }
    }
  } catch (err: any) {
    self.postMessage({
      type: 'error',
      id: req.id,
      error: err?.message ?? String(err),
      logs: [],
    } satisfies ErrorResponse);
  }
};
