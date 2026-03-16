// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Web worker for slicing STL/3MF models via libslic3r WASM.
 *
 * Messages IN:
 *   { type: 'slice', stlData: ArrayBuffer, config: Record<string, string> }
 *     — slice a single-color STL model
 *   { type: 'slice3mf', data: ArrayBuffer, config: Record<string, string> }
 *     — slice a multi-color 3MF model
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
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
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
};
