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

import type { SliceStats } from '../types/print-profile';

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
  // Resolved config + stats API (added in Phase 1)
  getSliceStats(): string;
  getResolvedConfig(key: string): string;
  getResolvedConfigs(keys: unknown): string;
  // Multi-object Build Plate API
  clearModel(): void;
  addSTLObject(path: string, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number;
  add3MFObject(path: string, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number;
  setObjectConfig(objectIndex: number, key: string, value: string): void;
  setVolumeExtruder(objectIndex: number, volumeIndex: number, extruder: number): void;
  setPrintSequence(mode: string): void;
  getObjectCount(): number;
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
  /** Which WASM variant is loaded: 'wasm32' or 'wasm64' */
  readonly variant: 'wasm32' | 'wasm64';
  /** Load an STL model from binary data */
  loadSTL(buffer: ArrayBuffer | Uint8Array): void;
  /** Load a 3MF model from binary data (multi-color extruder assignments preserved) */
  load3MF(buffer: ArrayBuffer | Uint8Array): void;
  /** Set OrcaSlicer config entries (key=value pairs) */
  setConfig(entries: Record<string, string>): void;
  /** Run the slicing pipeline. Optional progress callback with WASM log messages. */
  slice(onProgress?: (stage: string, progress: number, message?: string) => void): void;
  /** Export the sliced result as GCode string. Must call slice() first. */
  exportGCode(): string;
  /** Release all C++ resources. The engine cannot be used after this. */
  destroy(): void;

  // --- Resolved Config + Stats API ---

  /**
   * Get print statistics after slicing. Must call slice() first.
   * Returns null if stats are unavailable (e.g., older WASM build without the method).
   */
  getSliceStats(): SliceStats | null;
  /**
   * Query multiple resolved config values by OrcaSlicer key name.
   * Must call slice() first — config is resolved during apply().
   * Returns empty object if unavailable (e.g., older WASM build).
   */
  getResolvedConfigs(keys: string[]): Record<string, string>;

  // --- Multi-object Build Plate API ---

  /** Clear the model, removing all objects. Resets state for a fresh plate. */
  clearModel(): void;
  /** Add an STL object to the plate. Returns the 0-based object index. */
  addSTLObject(buffer: ArrayBuffer | Uint8Array, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number;
  /** Add a 3MF object to the plate (multi-color volumes merged). Returns the 0-based object index. */
  add3MFObject(buffer: ArrayBuffer | Uint8Array, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number;
  /** Set per-object config overrides. Only keys that differ from global config need to be set. */
  setObjectConfig(objectIndex: number, entries: Record<string, string>): void;
  /** Set the extruder for a specific volume within an object. extruder is 1-based (OrcaSlicer convention). */
  setVolumeExtruder(objectIndex: number, volumeIndex: number, extruder: number): void;
  /** Set print sequence mode: 'by layer' or 'by object'. */
  setPrintSequence(mode: string): void;
  /** Return the number of objects currently on the plate. */
  getObjectCount(): number;
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
// Memory64 detection
// ---------------------------------------------------------------------------

let memory64Cached: boolean | null = null;

/**
 * Check whether the browser supports WebAssembly Memory64 (i64 index).
 * Memory64 allows WASM to address >4GB of memory, but has a 10-100%
 * performance penalty (no bounds-check elimination via virtual memory).
 * wasm64 should only be used as a fallback when wasm32 OOMs.
 *
 * Supported: Chrome 133+, Firefox 134+. Safari: not yet (as of 2025-05).
 */
export function supportsMemory64(): boolean {
  if (memory64Cached !== null) return memory64Cached;
  try {
    new WebAssembly.Memory({ initial: 1, index: 'i64' } as WebAssembly.MemoryDescriptor);
    memory64Cached = true;
  } catch {
    memory64Cached = false;
  }
  return memory64Cached;
}

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

/** Separate caches for wasm32 and wasm64 modules */
let cachedModulePromise32: Promise<SlicerModule> | null = null;
let cachedModulePromise64: Promise<SlicerModule> | null = null;


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
 *
 * @param wasm64 - If true, loads the wasm64 variant (libslic3r-wasm64.{js,wasm}).
 *                 Defaults to false (wasm32). The wasm64 variant supports >4GB
 *                 memory but has a 10-100% performance penalty.
 */
async function loadSlicerModule(wasm64 = false): Promise<SlicerModule> {
  const cached = wasm64 ? cachedModulePromise64 : cachedModulePromise32;
  if (cached) return cached;

  const basename = wasm64 ? 'libslic3r-wasm64' : 'libslic3r';
  const variant = wasm64 ? 'wasm64' : 'wasm32';

  const promise = (async () => {
    const base = resolveWasmBaseUrl();
    const jsUrl = `${base}/wasm/${basename}.js`;

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
        `Failed to fetch slicer WASM module (${variant}) from ${jsUrl} (HTTP ${resp.status}). ` +
        (wasm64
          ? 'The wasm64 slicer files may not be built yet. Build with: nix build .#orcaslicer-wasm64'
          : 'The libslic3r WASM files may not be built yet. Run: node scripts/build-slicer-wasm.mjs')
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
        `Failed to load slicer WASM module (${variant}) from ${jsUrl}. ` +
        (wasm64
          ? 'The wasm64 slicer files may not be built yet. Build with: nix build .#orcaslicer-wasm64'
          : 'The libslic3r WASM files may not be built yet. Run: node scripts/build-slicer-wasm.mjs')
      );
    }

    // Initialize the WASM module
    console.log(`[slicer-engine] Creating ${variant} WASM module...`, { jsUrl, base, isolated });

    const module = await createModule({
      // Let Emscripten locate the .wasm file relative to the JS glue
      locateFile: (path: string) => {
        console.log('[slicer-engine] locateFile:', path);
        if (path.endsWith('.wasm')) return `${base}/wasm/${basename}.wasm`;
        if (path.endsWith('.worker.js')) return `${base}/wasm/${basename}.worker.js`;
        return path;
      },
      // Point pthreads at the real JS URL, not the ESM blob wrapper.
      // Emscripten pthreads spawn classic (non-module) workers that load
      // this script — without this, they'd try to load the revoked blob URL
      // which contains an `export default` statement that fails in classic mode.
      mainScriptUrlOrBlob: jsUrl,
      print: (text: string) => console.log('[slicer-wasm]', text),
      printErr: (text: string) => console.warn('[slicer-wasm]', text),
    });
    console.log(`[slicer-engine] ${variant} WASM module created successfully`);

    // Ensure /tmp exists for the temp file helpers in slicer_bindings.cpp
    try { module.FS.mkdir('/tmp'); } catch { /* already exists */ }

    return module;
  })();

  // Store in the appropriate cache
  if (wasm64) {
    cachedModulePromise64 = promise;
    promise.catch(() => { cachedModulePromise64 = null; });
  } else {
    cachedModulePromise32 = promise;
    promise.catch(() => { cachedModulePromise32 = null; });
  }

  return promise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse libslic3r's print time string (e.g. "1d 2h 34m 56s") into seconds.
 * Returns 0 if the string can't be parsed.
 */
export function parsePrintTimeStr(s: string): number {
  let total = 0;
  const dayMatch = s.match(/(\d+)d/);
  const hourMatch = s.match(/(\d+)h/);
  const minMatch = s.match(/(\d+)m/);
  const secMatch = s.match(/(\d+)s/);
  if (dayMatch) total += parseInt(dayMatch[1], 10) * 86400;
  if (hourMatch) total += parseInt(hourMatch[1], 10) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  return total;
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
 * @param wasm64 - If true, loads the wasm64 variant (>4GB memory support,
 *                 10-100% slower). Defaults to false (wasm32).
 *
 * Must be called from a Web Worker context.
 */
export async function createSlicerEngine(wasm64 = false): Promise<SlicerEngine> {
  const module = await loadSlicerModule(wasm64);
  const variant: 'wasm32' | 'wasm64' = wasm64 ? 'wasm64' : 'wasm32';
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
    variant,

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
      const skipped: string[] = [];
      for (const [key, value] of Object.entries(entries)) {
        try {
          s.setConfigString(key, value);
        } catch (e: unknown) {
          // Decode the WASM exception to check if it's a bad-value error
          const decoded = decodeWasmException(e, `setConfig(${key}=${value})`);
          if (decoded.message.includes('BadOptionValueException') ||
              decoded.message.includes('UnknownOptionException') ||
              decoded.message.includes('Invalid value')) {
            // Log and skip — this key/value is not recognized by this OrcaSlicer build
            console.warn(`[slicer-engine] Skipping config key="${key}" value="${value}": ${decoded.message}`);
            skipped.push(key);
          } else {
            // Unexpected error — re-throw
            console.error(`[slicer-engine] setConfigString failed for key="${key}" value="${value}":`, decoded.message);
            throw decoded;
          }
        }
      }
      if (skipped.length > 0) {
        console.warn(`[slicer-engine] Skipped ${skipped.length} unsupported config keys: ${skipped.join(', ')}`);
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
      const origError = console.error;
      // Capture C++ EM_ASM console.error messages — these fire synchronously
      // before the exception reaches JS, and contain the actual error text
      // (e.g. "slice() failed: std::bad_alloc") that we need for OOM detection
      let lastErrorMsg = '';
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
      console.error = (...args: unknown[]) => {
        origError.apply(console, args);
        const text = args.map(String).join(' ');
        if (text.includes('[slicer-wasm]')) {
          lastErrorMsg = text;
        }
      };

      try {
        getSlicer().slice();
      } catch (e: unknown) {
        origError('[slicer-engine] slice() exception:', typeof e, e);
        // If we can't decode the WASM exception but captured the C++ error message,
        // use that instead — it contains the actual exception text (e.g. "bad_alloc")
        const decoded = decodeWasmException(e, 'slice');
        if (lastErrorMsg && decoded.message.includes('WASM exception (ptr=')) {
          throw new Error(`slice(): ${lastErrorMsg.replace(/^\[slicer-wasm\]\s*/, '')}`);
        }
        throw decoded;
      } finally {
        console.log = origLog;
        console.warn = origWarn;
        console.error = origError;
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

    // --- Resolved Config + Stats API ---

    getSliceStats(): SliceStats | null {
      try {
        const s = getSlicer();
        if (typeof s.getSliceStats !== 'function') {
          console.warn('[slicer-engine] getSliceStats() not available on this WASM build');
          return null;
        }
        const json = s.getSliceStats();
        const raw = JSON.parse(json);
        return {
          printTime: parsePrintTimeStr(raw.estimated_normal_print_time ?? ''),
          printTimeStr: raw.estimated_normal_print_time ?? '',
          totalFilamentG: raw.total_used_filament ?? 0,
          totalFilamentMm3: raw.total_extruded_volume ?? 0,
          totalWeight: raw.total_weight ?? 0,
          totalCost: raw.total_cost ?? 0,
          totalToolchanges: raw.total_toolchanges ?? 0,
          initialTool: raw.initial_tool ?? 0,
          wipeTowerFilament: raw.total_wipe_tower_filament ?? 0,
          perExtruderFilament: raw.filament_stats ?? {},
          layerCount: raw.layer_count ?? 0,
          supportLayerCount: raw.support_layer_count ?? 0,
        };
      } catch (e: unknown) {
        console.warn('[slicer-engine] getSliceStats() failed:', e);
        return null;
      }
    },

    getResolvedConfigs(keys: string[]): Record<string, string> {
      try {
        const s = getSlicer();
        if (typeof s.getResolvedConfigs !== 'function') {
          console.warn('[slicer-engine] getResolvedConfigs() not available on this WASM build');
          return {};
        }
        const json = s.getResolvedConfigs(keys);
        return JSON.parse(json);
      } catch (e: unknown) {
        console.warn('[slicer-engine] getResolvedConfigs() failed:', e);
        return {};
      }
    },

    // --- Multi-object Build Plate API ---

    clearModel(): void {
      try {
        getSlicer().clearModel();
      } catch (e: unknown) {
        throw decodeWasmException(e, 'clearModel');
      }
    },

    addSTLObject(buffer: ArrayBuffer | Uint8Array, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number {
      const path = writeToVFS(module.FS, buffer, '.stl');
      try {
        return getSlicer().addSTLObject(path, posX, posY, rotZ, scaleX, scaleY, scaleZ);
      } catch (e: unknown) {
        throw decodeWasmException(e, 'addSTLObject');
      } finally {
        try { module.FS.unlink(path); } catch { /* ignore cleanup errors */ }
      }
    },

    add3MFObject(buffer: ArrayBuffer | Uint8Array, posX: number, posY: number, rotZ: number, scaleX: number, scaleY: number, scaleZ: number): number {
      const path = writeToVFS(module.FS, buffer, '.3mf');
      try {
        return getSlicer().add3MFObject(path, posX, posY, rotZ, scaleX, scaleY, scaleZ);
      } catch (e: unknown) {
        throw decodeWasmException(e, 'add3MFObject');
      } finally {
        try { module.FS.unlink(path); } catch { /* ignore cleanup errors */ }
      }
    },

    setObjectConfig(objectIndex: number, entries: Record<string, string>): void {
      const s = getSlicer();
      for (const [key, value] of Object.entries(entries)) {
        try {
          s.setObjectConfig(objectIndex, key, value);
        } catch (e: unknown) {
          const decoded = decodeWasmException(e, `setObjectConfig(${objectIndex}, ${key}=${value})`);
          // Log and skip unrecognized keys, same pattern as setConfig
          if (decoded.message.includes('BadOptionValueException') ||
              decoded.message.includes('UnknownOptionException') ||
              decoded.message.includes('Invalid value') ||
              decoded.message.includes('out of range')) {
            console.warn(`[slicer-engine] Skipping per-object config key="${key}" value="${value}": ${decoded.message}`);
          } else {
            throw decoded;
          }
        }
      }
    },

    setVolumeExtruder(objectIndex: number, volumeIndex: number, extruder: number): void {
      try {
        getSlicer().setVolumeExtruder(objectIndex, volumeIndex, extruder);
      } catch (e: unknown) {
        throw decodeWasmException(e, `setVolumeExtruder(${objectIndex}, ${volumeIndex}, ${extruder})`);
      }
    },

    setPrintSequence(mode: string): void {
      try {
        getSlicer().setPrintSequence(mode);
      } catch (e: unknown) {
        throw decodeWasmException(e, 'setPrintSequence');
      }
    },

    getObjectCount(): number {
      try {
        return getSlicer().getObjectCount();
      } catch (e: unknown) {
        throw decodeWasmException(e, 'getObjectCount');
      }
    },
  };
}
