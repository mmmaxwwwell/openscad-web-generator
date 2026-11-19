// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web worker for slicing STL/3MF models via libslic3r WASM.
 *
 * Messages IN:
 *   { type: 'slice', stlData: ArrayBuffer, config: Record<string, string> }
 *     — slice a single-color STL model
 *   { type: 'slice3mf', data: ArrayBuffer, config: Record<string, string> }
 *     — slice a multi-color 3MF model
 *   { type: 'slicePlate', objects: Array<PlateObjectMsg>, globalConfig: Record<string, string>, printSequence?: string }
 *     — slice a multi-object build plate
 *   { type: 'getResolvedConfigs', keys: string[] }
 *     — query resolved config values from the last slice (engine must still be alive)
 *   { type: 'cancel' }
 *     — cancel current operation (best-effort; WASM slicing is not interruptible)
 *
 * Messages OUT:
 *   { type: 'progress', stage: string, progress: number }
 *     — progress update (0..1 within stage)
 *   { type: 'done', gcode: string, stats: { printTime?: number, filamentUsed?: number }, nativeStats?: SliceStats, resolvedConfigs?: Record<string, string> }
 *     — slicing complete (nativeStats and resolvedConfigs available when WASM supports them)
 *   { type: 'resolvedConfigs', configs: Record<string, string> }
 *     — response to getResolvedConfigs request
 *   { type: 'error', message: string }
 *     — slicing failed
 */

import { createSlicerEngine, supportsMemory64, type SlicerEngine } from '../lib/slicer-engine';
import { parseGcodeStats } from '../hooks/useSlicer';
import type { SliceStats } from '../types/print-profile';

/** OrcaSlicer config keys where value=0 means "auto" and the slicer resolves them */
const AUTO_RESOLVE_KEYS = [
  'line_width', 'outer_wall_line_width', 'inner_wall_line_width',
  'top_surface_line_width', 'internal_solid_infill_line_width',
  'sparse_infill_line_width', 'support_line_width', 'initial_layer_line_width',
  'overhang_1_4_speed', 'overhang_2_4_speed', 'overhang_3_4_speed', 'overhang_4_4_speed',
  'scarf_joint_speed', 'support_speed', 'support_interface_speed',
  'support_interface_spacing', 'bridge_angle', 'internal_bridge_angle',
  'deretraction_speed',
];

/** Shape of each object in a slicePlate message */
export interface PlateObjectMsg {
  data: ArrayBuffer;
  format: 'stl' | '3mf';
  posX: number;
  posY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  config?: Record<string, string>;
  /** Per-volume extruder assignments (volume index → 1-based extruder) */
  volumeExtruders?: Record<number, number>;
}

let cancelled = false;
let engine: SlicerEngine | null = null;

/** Destroy the current engine if it exists, freeing C++ memory */
function destroyEngine(): void {
  if (engine) {
    try {
      engine.destroy();
    } catch {
      // Ignore cleanup errors
    }
    engine = null;
  }
}

/**
 * Detect whether an error is an out-of-memory condition.
 * Emscripten throws various error messages for OOM — match the common patterns.
 */
function isOomError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /out of memory|Cannot enlarge memory|memory access out of bounds|Aborted\(OOM\)|allocation failed|bad_alloc/i.test(msg);
}

/** Query native stats and resolved configs from the engine after slicing */
function getEngineResults(engine: SlicerEngine): {
  nativeStats: SliceStats | null;
  resolvedConfigs: Record<string, string>;
} {
  const nativeStats = engine.getSliceStats();
  const resolvedConfigs = engine.getResolvedConfigs(AUTO_RESOLVE_KEYS);
  return { nativeStats, resolvedConfigs };
}

function sendProgress(stage: string, progress: number, message?: string): void {
  if (!cancelled) {
    self.postMessage({ type: 'progress', stage, progress, message });
  }
}

async function handleSlice(
  data: ArrayBuffer,
  config: Record<string, string>,
  format: 'stl' | '3mf',
  wasm64 = false,
): Promise<void> {
  cancelled = false;
  // Destroy any previous engine before creating a new one
  destroyEngine();

  const variantLabel = wasm64 ? 'WASM64' : 'WASM';

  try {
    // Load the WASM module and create a fresh engine instance
    sendProgress('loading', 0, `Loading ${variantLabel} slicer engine...`);
    engine = await createSlicerEngine(wasm64);
    if (cancelled) return;
    sendProgress('loading', 1);

    // Load the model
    sendProgress('loading_model', 0);
    if (format === '3mf') {
      engine.load3MF(data);
    } else {
      engine.loadSTL(data);
    }
    if (cancelled) return;
    sendProgress('loading_model', 1);

    // Apply config
    sendProgress('configuring', 0);
    engine.setConfig(config);
    if (cancelled) return;
    sendProgress('configuring', 1);

    // Slice — progress messages forwarded from C++ EM_ASM console output
    engine.slice((stage, progress, message) => {
      if (!cancelled) {
        sendProgress(stage, progress, message);
      }
    });
    if (cancelled) return;

    // Export GCode
    sendProgress('exporting', 0);
    const gcode = engine.exportGCode();
    sendProgress('exporting', 1);

    if (cancelled) return;

    // Get native stats + resolved configs from C++ (if available)
    // Engine stays alive so getResolvedConfigs can be called later
    const { nativeStats, resolvedConfigs } = getEngineResults(engine);

    // Parse stats from GCode comments as fallback
    const stats = parseGcodeStats(gcode);

    const engineName = wasm64 ? 'WASM64' : 'WASM';
    self.postMessage({ type: 'done', gcode, stats, nativeStats, resolvedConfigs, engineName });
  } catch (err) {
    // Destroy engine on error — no useful state to query
    destroyEngine();

    // OOM retry: if wasm32 ran out of memory, retry with wasm64 (if supported)
    if (!wasm64 && !cancelled && isOomError(err) && supportsMemory64()) {
      console.warn('[slicer-worker] wasm32 OOM — retrying with wasm64...');
      sendProgress('loading', 0, 'Out of memory — retrying with WASM64 (larger address space)...');
      return handleSlice(data, config, format, true);
    }

    if (!cancelled) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'number') {
        // Raw WASM exception pointer — try to decode it
        message = `WASM exception (ptr=${err}). A config key or value may be invalid.`;
      } else {
        message = String(err);
      }
      self.postMessage({ type: 'error', message });
    }
  }
}

async function handleSlicePlate(
  objects: PlateObjectMsg[],
  globalConfig: Record<string, string>,
  printSequence?: string,
  wasm64 = false,
): Promise<void> {
  cancelled = false;
  // Destroy any previous engine before creating a new one
  destroyEngine();

  const variantLabel = wasm64 ? 'WASM64' : 'WASM';

  try {
    // Load the WASM module
    sendProgress('loading', 0, `Loading ${variantLabel} slicer engine...`);
    engine = await createSlicerEngine(wasm64);
    if (cancelled) return;
    sendProgress('loading', 1);

    // Clear any previous model state
    sendProgress('loading_model', 0, 'Clearing model...');
    engine.clearModel();
    if (cancelled) return;

    // Add each object to the plate
    const totalObjects = objects.length;
    for (let i = 0; i < totalObjects; i++) {
      if (cancelled) return;
      const obj = objects[i];
      const progress = (i + 0.5) / totalObjects;
      sendProgress('loading_model', progress, `Loading object ${i + 1}/${totalObjects}...`);

      let objectIndex: number;
      if (obj.format === '3mf') {
        objectIndex = engine.add3MFObject(obj.data, obj.posX, obj.posY, obj.rotZ, obj.scaleX, obj.scaleY, obj.scaleZ);
      } else {
        objectIndex = engine.addSTLObject(obj.data, obj.posX, obj.posY, obj.rotZ, obj.scaleX, obj.scaleY, obj.scaleZ);
      }

      // Apply per-object config overrides if present
      if (obj.config && Object.keys(obj.config).length > 0) {
        engine.setObjectConfig(objectIndex, obj.config);
      }

      // Apply per-volume extruder assignments (multicolor 3MF objects)
      if (obj.volumeExtruders) {
        for (const [volIdx, extruder] of Object.entries(obj.volumeExtruders)) {
          engine.setVolumeExtruder(objectIndex, Number(volIdx), extruder);
        }
      }
    }
    if (cancelled) return;
    sendProgress('loading_model', 1);

    // Apply global config
    sendProgress('configuring', 0);
    engine.setConfig(globalConfig);

    // Set print sequence AFTER setConfig (setConfig overwrites print_sequence)
    // Map TypeScript enum values (by_layer/by_object) to WASM expected values (by layer/by object)
    if (printSequence) {
      const wasmMode = printSequence.replace('_', ' ');
      engine.setPrintSequence(wasmMode);
    }
    if (cancelled) return;
    sendProgress('configuring', 1);

    // Slice
    engine.slice((stage, progress, message) => {
      if (!cancelled) {
        sendProgress(stage, progress, message);
      }
    });
    if (cancelled) return;

    // Export GCode
    sendProgress('exporting', 0);
    const gcode = engine.exportGCode();
    sendProgress('exporting', 1);

    if (cancelled) return;

    // Get native stats + resolved configs from C++ (if available)
    // Engine stays alive so getResolvedConfigs can be called later
    const { nativeStats, resolvedConfigs } = getEngineResults(engine);

    const stats = parseGcodeStats(gcode);
    const engineName = wasm64 ? 'WASM64' : 'WASM';
    self.postMessage({ type: 'done', gcode, stats, nativeStats, resolvedConfigs, engineName });
  } catch (err) {
    // Destroy engine on error — no useful state to query
    destroyEngine();

    // OOM retry: if wasm32 ran out of memory, retry with wasm64 (if supported)
    if (!wasm64 && !cancelled && isOomError(err) && supportsMemory64()) {
      console.warn('[slicer-worker] wasm32 OOM on plate slice — retrying with wasm64...');
      sendProgress('loading', 0, 'Out of memory — retrying with WASM64 (larger address space)...');
      return handleSlicePlate(objects, globalConfig, printSequence, true);
    }

    if (!cancelled) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else if (typeof err === 'number') {
        message = `WASM exception (ptr=${err}). A config key or value may be invalid.`;
      } else {
        message = String(err);
      }
      self.postMessage({ type: 'error', message });
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    // Destroy the engine on cancel — no useful state to query
    destroyEngine();
    return;
  }

  if (msg.type === 'getResolvedConfigs') {
    // Query resolved config values from the last slice's engine
    if (!engine) {
      self.postMessage({ type: 'resolvedConfigs', configs: {} });
      return;
    }
    try {
      const configs = engine.getResolvedConfigs(msg.keys || AUTO_RESOLVE_KEYS);
      self.postMessage({ type: 'resolvedConfigs', configs });
    } catch (err) {
      console.warn('[slicer-worker] getResolvedConfigs failed:', err);
      self.postMessage({ type: 'resolvedConfigs', configs: {} });
    }
    return;
  }

  if (msg.type === 'slice') {
    handleSlice(msg.stlData, msg.config || {}, 'stl');
    return;
  }

  if (msg.type === 'slice3mf') {
    handleSlice(msg.data, msg.config || {}, '3mf');
    return;
  }

  if (msg.type === 'slicePlate') {
    handleSlicePlate(msg.objects || [], msg.globalConfig || {}, msg.printSequence);
    return;
  }
};
