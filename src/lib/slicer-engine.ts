// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Typed wrapper around the libslic3r WASM module.
 *
 * Loads the Emscripten-compiled libslic3r WASM binary and exposes
 * a clean async API for slicing STL/3MF models to GCode.
 *
 * This module is designed to run inside a Web Worker context because:
 * 1. Slicing is CPU-intensive and would block the main thread
 * 2. pthreads (SharedArrayBuffer) require COOP/COEP headers
 * 3. The WASM module is configured with ENVIRONMENT=worker
 *
 * COOP/COEP Requirements for pthreads:
 * The dev server and production server must set these headers:
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 * Without these headers, SharedArrayBuffer is unavailable and
 * the WASM module will fail to initialize its thread pool.
 */

// ---------------------------------------------------------------------------
// Emscripten module types
// ---------------------------------------------------------------------------

/** Embind-generated WasmSlicer class on the Module object */
interface WasmSlicerInstance {
  loadSTLFile(path: string): void;
  load3MFFile(path: string): void;
  setConfigString(key: string, value: string): void;
  slice(): void;
  exportGCode(): string;
  /** embind destructor — must be called to free C++ memory */
  delete(): void;
}

/** The Emscripten module as produced by createSlicerModule() */
interface SlicerModule {
  WasmSlicer: new () => WasmSlicerInstance;
  /** Emscripten FS API (available because of FORCE_FILESYSTEM) */
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array | string): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  /**
   * Decode a WASM exception pointer into a human-readable message.
   * Available when EXPORTED_RUNTIME_METHODS includes 'getExceptionMessage'.
   * Returns [type, message] for C++ exceptions.
   */
  getExceptionMessage?: (ptr: number) => [string, string];
}

/** Factory function exported by the Emscripten glue JS */
type CreateSlicerModule = (opts?: Record<string, unknown>) => Promise<SlicerModule>;

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export interface SlicerEngine {
  /** Load an STL model from binary data */
  loadSTL(buffer: ArrayBuffer | Uint8Array): void;
  /** Load a 3MF model from binary data (multi-color extruder assignments preserved) */
  load3MF(buffer: ArrayBuffer | Uint8Array): void;
  /** Set PrusaSlicer config entries (key=value pairs in .ini format) */
  setConfig(entries: Record<string, string>): void;
  /** Run the slicing pipeline. Optional progress callback with WASM log messages. */
  slice(onProgress?: (stage: string, progress: number, message?: string) => void): void;
  /** Export the sliced result as GCode string. Must call slice() first. */
  exportGCode(): string;
  /** Release all C++ resources. The engine cannot be used after this. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// COOP/COEP detection
// ---------------------------------------------------------------------------

/**
 * Check whether SharedArrayBuffer is available (requires COOP/COEP headers).
 * Returns true if pthreads can work, false otherwise.
 */
export function checkCrossOriginIsolation(): boolean {
  // In a worker context, crossOriginIsolated is a global property
  if (typeof crossOriginIsolated !== 'undefined') {
    return crossOriginIsolated;
  }
  // Fallback: try to construct a SharedArrayBuffer
  try {
    new SharedArrayBuffer(1);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

let cachedModulePromise: Promise<SlicerModule> | null = null;


/**
 * Resolve the base URL for WASM assets, handling both absolute (GitHub Pages)
 * and relative (APK) BASE_URL configurations.
 */
function resolveWasmBaseUrl(): string {
  const baseUrl = (import.meta as any).env?.BASE_URL || '/';
  if (baseUrl.startsWith('/')) {
    return new URL(baseUrl, self.location.origin).href.replace(/\/$/, '');
  }
  // Relative BASE_URL (APK): resolve from one level up (worker lives in assets/)
  return new URL('../' + baseUrl, self.location.href).href.replace(/\/$/, '');
}

/**
 * Load the Emscripten module. Caches the result so subsequent calls
 * return the same module instance (the module is reusable — unlike OpenSCAD,
 * libslic3r doesn't call exit()).
 */
async function loadSlicerModule(): Promise<SlicerModule> {
  if (cachedModulePromise) return cachedModulePromise;

  cachedModulePromise = (async () => {
    const base = resolveWasmBaseUrl();
    const jsUrl = `${base}/wasm/libslic3r.js`;

    // Verify COOP/COEP for pthreads support
    const isolated = checkCrossOriginIsolation();
    if (!isolated) {
      console.warn(
        '[slicer-engine] Cross-origin isolation is NOT enabled. ' +
        'SharedArrayBuffer is unavailable — pthreads will not work. ' +
        'Set Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp on your server.'
      );
    }

    // Load the Emscripten glue JS. The file uses CJS/AMD exports (not ESM),
    // so dynamic import() won't expose the factory function. We fetch the
    // script, wrap it with an ESM export, and import it via a Blob URL.
    const resp = await fetch(jsUrl);
    if (!resp.ok) {
      throw new Error(
        `Failed to fetch slicer WASM module from ${jsUrl} (HTTP ${resp.status}). ` +
        'The libslic3r WASM files may not be built yet. ' +
        'Run: node scripts/build-slicer-wasm.mjs'
      );
    }
    const scriptText = await resp.text();

    // Wrap the CJS/AMD script as an ES module by appending an export.
    // The original script defines `createSlicerModule` as a top-level function
    // and has CJS/AMD export blocks that are harmless when module/exports/define
    // are not present.
    const esmWrapped = scriptText + '\nexport default createSlicerModule;\n';
    const blob = new Blob([esmWrapped], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    let createModule: CreateSlicerModule;
    try {
      const glueModule = await import(/* @vite-ignore */ blobUrl);
      createModule = glueModule.default;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }

    if (typeof createModule !== 'function') {
      throw new Error(
        `Failed to load slicer WASM module from ${jsUrl}. ` +
        'The libslic3r WASM files may not be built yet. ' +
        'Run: node scripts/build-slicer-wasm.mjs'
      );
    }

    // Initialize the WASM module
    console.log('[slicer-engine] Creating WASM module...', { jsUrl, base, isolated });

    const module = await createModule({
      // Let Emscripten locate the .wasm file relative to the JS glue
      locateFile: (path: string) => {
        console.log('[slicer-engine] locateFile:', path);
        if (path.endsWith('.wasm')) return `${base}/wasm/libslic3r.wasm`;
        if (path.endsWith('.worker.js')) return `${base}/wasm/libslic3r.worker.js`;
        return path;
      },
      // Point pthreads at the real libslic3r.js URL, not the ESM blob wrapper.
      // Emscripten pthreads spawn classic (non-module) workers that load
      // this script — without this, they'd try to load the revoked blob URL
      // which contains an `export default` statement that fails in classic mode.
      mainScriptUrlOrBlob: jsUrl,
      print: (text: string) => console.log('[slicer-wasm]', text),
      printErr: (text: string) => console.warn('[slicer-wasm]', text),
    });
    console.log('[slicer-engine] WASM module created successfully');

    // Ensure /tmp exists for the temp file helpers in slicer_bindings.cpp
    try { module.FS.mkdir('/tmp'); } catch { /* already exists */ }

    return module;
  })();

  // If loading fails, clear the cache so a retry is possible
  cachedModulePromise.catch(() => { cachedModulePromise = null; });

  return cachedModulePromise;
}

// ---------------------------------------------------------------------------
// Engine factory
// ---------------------------------------------------------------------------

/** Counter for unique temp file names on the Emscripten virtual filesystem */
let tempFileCounter = 0;

/**
 * Write binary data to the Emscripten MEMFS virtual filesystem and return
 * the path. This avoids embind's UTF-8 string marshaling which corrupts
 * binary data — bytes >127 get multi-byte encoded when passed as std::string
 * through embind. Instead, we write binary data directly via Module.FS.writeFile()
 * (which accepts Uint8Array without encoding) and pass the file path to C++.
 */
function writeToVFS(
  fs: SlicerModule['FS'],
  data: ArrayBuffer | Uint8Array,
  ext: string,
): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const path = `/tmp/slicer_input_${tempFileCounter++}${ext}`;
  fs.writeFile(path, bytes);
  return path;
}

/**
 * Create a new SlicerEngine instance.
 *
 * Loads the WASM module (cached after first call) and creates a fresh
 * WasmSlicer C++ object. Each engine instance is independent and can
 * be used for one slice operation at a time.
 *
 * Must be called from a Web Worker context.
 */
export async function createSlicerEngine(): Promise<SlicerEngine> {
  const module = await loadSlicerModule();
  let slicer: WasmSlicerInstance | null = new module.WasmSlicer();
  let destroyed = false;

  function getSlicer(): WasmSlicerInstance {
    if (destroyed || !slicer) {
      throw new Error('SlicerEngine has been destroyed');
    }
    return slicer;
  }

  /**
   * Decode a WASM exception. When compiled with -fwasm-exceptions, C++
   * exceptions escape to JS as bare pointer numbers (e.g. 1641544).
   * If getExceptionMessage is available (via EXPORTED_RUNTIME_METHODS),
   * decode the pointer into a readable error message. Otherwise, return
   * a generic message with the raw pointer value.
   */
  function decodeWasmException(e: unknown, context: string): Error {
    if (typeof e === 'number') {
      if (module.getExceptionMessage) {
        try {
          const [type, message] = module.getExceptionMessage(e);
          return new Error(`${context}: C++ ${type}: ${message}`);
        } catch {
          return new Error(`${context}: WASM exception (ptr=${e}), could not decode`);
        }
      }
      return new Error(`${context}: WASM exception (ptr=${e}). Rebuild with EXPORTED_RUNTIME_METHODS=['getExceptionMessage'] for details.`);
    }
    if (e instanceof Error) return e;
    // Emscripten exception objects may have a message property or be plain objects
    if (e && typeof e === 'object') {
      const obj = e as Record<string, unknown>;
      if (obj.message) return new Error(`${context}: ${String(obj.message)}`);
      try {
        return new Error(`${context}: ${JSON.stringify(e)}`);
      } catch {
        // circular reference or other JSON error
      }
    }
    return new Error(`${context}: ${String(e)}`);
  }

  return {
    loadSTL(buffer: ArrayBuffer | Uint8Array): void {
      const path = writeToVFS(module.FS, buffer, '.stl');
      try {
        getSlicer().loadSTLFile(path);
      } catch (e: unknown) {
        throw decodeWasmException(e, 'loadSTL');
      } finally {
        try { module.FS.unlink(path); } catch { /* ignore cleanup errors */ }
      }
    },

    load3MF(buffer: ArrayBuffer | Uint8Array): void {
      const path = writeToVFS(module.FS, buffer, '.3mf');
      try {
        getSlicer().load3MFFile(path);
      } catch (e: unknown) {
        throw decodeWasmException(e, 'load3MF');
      } finally {
        try { module.FS.unlink(path); } catch { /* ignore cleanup errors */ }
      }
    },

    setConfig(entries: Record<string, string>): void {
      const s = getSlicer();
      for (const [key, value] of Object.entries(entries)) {
        s.setConfigString(key, value);
      }
    },

    slice(onProgress?: (stage: string, progress: number, message?: string) => void): void {
      // Install the print handler so WASM stdout/stderr during the blocking
      // slice() call gets forwarded as progress messages to the worker's
      // postMessage (via onProgress). The Emscripten print/printErr callbacks
      // capture C++ stdout/stderr, and we also intercept console.log/warn
      // to capture EM_ASM messages from the C++ code (which call console.log
      // directly, bypassing the Emscripten print callback).
      onProgress?.('slicing', 0);

      // Intercept console.log/warn to capture both:
      // 1. Emscripten print/printErr output (C++ stdout/stderr)
      // 2. EM_ASM calls that call console.log directly from C++
      // These fire synchronously during the blocking slice() call, and
      // postMessage enqueues messages to the main thread even while blocked.
      const origLog = console.log;
      const origWarn = console.warn;
      if (onProgress) {
        console.log = (...args: unknown[]) => {
          origLog.apply(console, args);
          // Extract message text, stripping the [slicer-wasm] prefix if present
          const text = args.map(String).join(' ');
          const cleaned = text.replace(/^\[slicer-wasm\]\s*/, '');
          if (cleaned) onProgress('slicing', 0.5, cleaned);
        };
        console.warn = (...args: unknown[]) => {
          origWarn.apply(console, args);
          const text = args.map(String).join(' ');
          const cleaned = text.replace(/^\[slicer-wasm\]\s*/, '');
          if (cleaned) onProgress('slicing', 0.5, cleaned);
        };
      }

      try {
        getSlicer().slice();
      } catch (e: unknown) {
        console.error('[slicer-engine] slice() exception:', typeof e, e);
        throw decodeWasmException(e, 'slice');
      } finally {
        console.log = origLog;
        console.warn = origWarn;
      }
      onProgress?.('slicing', 1);
    },

    exportGCode(): string {
      try {
        return getSlicer().exportGCode();
      } catch (e: unknown) {
        throw decodeWasmException(e, 'exportGCode');
      }
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (slicer) {
        slicer.delete();
        slicer = null;
      }
    },
  };
}
