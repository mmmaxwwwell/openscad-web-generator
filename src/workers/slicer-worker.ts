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
 *   { type: 'cancel' }
 *     — cancel current operation (best-effort; WASM slicing is not interruptible)
 *
 * Messages OUT:
 *   { type: 'progress', stage: string, progress: number }
 *     — progress update (0..1 within stage)
 *   { type: 'done', gcode: string, stats: { printTime?: number, filamentUsed?: number } }
 *     — slicing complete
 *   { type: 'error', message: string }
 *     — slicing failed
 */

import { createSlicerEngine, type SlicerEngine } from '../lib/slicer-engine';
import { parseGcodeStats } from '../hooks/useSlicer';

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
}

let cancelled = false;
let engine: SlicerEngine | null = null;

function sendProgress(stage: string, progress: number, message?: string): void {
  if (!cancelled) {
    self.postMessage({ type: 'progress', stage, progress, message });
  }
}

async function handleSlice(
  data: ArrayBuffer,
  config: Record<string, string>,
  format: 'stl' | '3mf',
): Promise<void> {
  cancelled = false;

  try {
    // Load the WASM module and create a fresh engine instance
    sendProgress('loading', 0);
    engine = await createSlicerEngine();
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

    // Parse stats from GCode comments
    const stats = parseGcodeStats(gcode);

    self.postMessage({ type: 'done', gcode, stats });
  } catch (err) {
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
  } finally {
    // Clean up the engine instance to free C++ memory
    if (engine) {
      try {
        engine.destroy();
      } catch {
        // Ignore cleanup errors
      }
      engine = null;
    }
  }
}

async function handleSlicePlate(
  objects: PlateObjectMsg[],
  globalConfig: Record<string, string>,
  printSequence?: string,
): Promise<void> {
  cancelled = false;

  try {
    // Load the WASM module
    sendProgress('loading', 0);
    engine = await createSlicerEngine();
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

    const stats = parseGcodeStats(gcode);
    self.postMessage({ type: 'done', gcode, stats });
  } catch (err) {
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
  } finally {
    if (engine) {
      try {
        engine.destroy();
      } catch {
        // Ignore cleanup errors
      }
      engine = null;
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  if (msg.type === 'cancel') {
    cancelled = true;
    // Note: WASM slicing is not interruptible — this flag prevents
    // sending further progress/done messages after the current operation
    // completes. The engine is destroyed in the finally block.
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
