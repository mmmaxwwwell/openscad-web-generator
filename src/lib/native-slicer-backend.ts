// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * TypeScript side of the Android native slicer bridge.
 *
 * Detects `window.NativeSlicer` (registered by SlicerBridge.java) and provides
 * an async slice API that transfers data via base64, calls sliceAsync on the
 * Java side, and resolves when the global callback fires.
 *
 * Progress is forwarded via window.onSlicerProgress → the onProgress callback.
 * Results come via window.onSlicerResult, errors via window.onSlicerError.
 */

import { parseGcodeStats } from '../hooks/useSlicer';
import type { SliceResult } from '../hooks/useSlicer';

// ---------------------------------------------------------------------------
// Android bridge type declarations
// ---------------------------------------------------------------------------

/** The @JavascriptInterface object registered as window.NativeSlicer */
interface NativeSlicerBridge {
  isAvailable(): boolean;
  engineName(): string;
  sliceAsync(inputPath: string, configJson: string, callbackId: string): void;
  cancelSlice(callbackId: string): void;
  writeInputFile(base64Data: string, fileName: string): string;
  readOutputFile(path: string): string;
}

declare global {
  interface Window {
    NativeSlicer?: NativeSlicerBridge;
    onSlicerProgress?: (callbackId: string, stage: string, progress: number) => void;
    onSlicerResult?: (callbackId: string, gcodePath: string) => void;
    onSlicerError?: (callbackId: string, message: string) => void;
  }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check if the native Android slicer bridge is available */
export function isNativeSlicerAvailable(): boolean {
  try {
    return !!window.NativeSlicer?.isAvailable();
  } catch {
    return false;
  }
}

/** Get the native engine name (e.g. "Native ARM") or null if unavailable */
export function getNativeEngineName(): string | null {
  try {
    return window.NativeSlicer?.engineName() ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Callback registry
// ---------------------------------------------------------------------------

type ProgressCallback = (stage: string, progress: number) => void;

interface PendingSlice {
  resolve: (result: SliceResult) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressCallback;
}

const pendingSlices = new Map<string, PendingSlice>();
let callbackCounter = 0;
let globalCallbacksInstalled = false;

/** Install the global window callbacks once */
function ensureGlobalCallbacks(): void {
  if (globalCallbacksInstalled) return;
  globalCallbacksInstalled = true;

  window.onSlicerProgress = (callbackId: string, stage: string, progress: number) => {
    const pending = pendingSlices.get(callbackId);
    if (pending?.onProgress) {
      pending.onProgress(stage, progress / 100);
    }
  };

  window.onSlicerResult = (callbackId: string, gcodePath: string) => {
    const pending = pendingSlices.get(callbackId);
    if (!pending) return;
    pendingSlices.delete(callbackId);

    try {
      const bridge = window.NativeSlicer;
      if (!bridge) {
        pending.reject(new Error('NativeSlicer disappeared'));
        return;
      }
      const gcode = bridge.readOutputFile(gcodePath);
      if (!gcode) {
        pending.reject(new Error('Failed to read GCode output'));
        return;
      }
      const stats = parseGcodeStats(gcode);
      pending.resolve({
        gcode,
        printTime: stats.printTime,
        filamentUsed: stats.filamentUsed,
      });
    } catch (e) {
      pending.reject(e instanceof Error ? e : new Error(String(e)));
    }
  };

  window.onSlicerError = (callbackId: string, message: string) => {
    const pending = pendingSlices.get(callbackId);
    if (!pending) return;
    pendingSlices.delete(callbackId);
    pending.reject(new Error(message));
  };
}

// ---------------------------------------------------------------------------
// ArrayBuffer → base64 helper
// ---------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Slice a model using the native Android slicer backend.
 *
 * @param input - STL or 3MF data as ArrayBuffer
 * @param config - OrcaSlicer config key/value pairs
 * @param format - 'stl' or '3mf'
 * @param onProgress - Optional progress callback (stage, 0-1 progress)
 * @returns Promise resolving to SliceResult with GCode and stats
 */
export function nativeSlice(
  input: ArrayBuffer,
  config: Record<string, string>,
  format: 'stl' | '3mf',
  onProgress?: ProgressCallback,
): Promise<SliceResult> {
  const bridge = window.NativeSlicer;
  if (!bridge) {
    return Promise.reject(new Error('Native slicer not available'));
  }

  ensureGlobalCallbacks();

  const callbackId = `slice_${Date.now()}_${callbackCounter++}`;
  const ext = format === '3mf' ? '.3mf' : '.stl';
  const fileName = `input_${callbackId}${ext}`;

  // Write model data to filesystem via bridge
  const base64Data = arrayBufferToBase64(input);
  const inputPath = bridge.writeInputFile(base64Data, fileName);
  if (!inputPath) {
    return Promise.reject(new Error('Failed to write input file to device'));
  }

  // Convert config to JSON string
  const configJson = JSON.stringify(config);

  return new Promise<SliceResult>((resolve, reject) => {
    pendingSlices.set(callbackId, { resolve, reject, onProgress });

    try {
      bridge.sliceAsync(inputPath, configJson, callbackId);
    } catch (e) {
      pendingSlices.delete(callbackId);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/**
 * Cancel a native slice operation by callback ID.
 * Typically called via the SlicerBackend abstraction, not directly.
 */
export function nativeCancelSlice(callbackId: string): void {
  const bridge = window.NativeSlicer;
  if (bridge) {
    try {
      bridge.cancelSlice(callbackId);
    } catch {
      // Bridge may be gone
    }
  }
  // The onSlicerError callback will handle cleanup
}
