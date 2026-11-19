// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Abstract slicer backend interface with WASM and native Android implementations.
 *
 * Factory function auto-selects the best available backend:
 * - Native ARM (Android) when window.NativeSlicer is present
 * - WASM (Web Worker) otherwise
 */

import type { SliceResult } from '../hooks/useSlicer';
import type { PlateObjectMsg } from '../workers/slicer-worker';
import {
  isNativeSlicerAvailable,
  getNativeEngineName,
  nativeSlice,
  nativeCancelSlice,
} from './native-slicer-backend';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export type ProgressCallback = (stage: string, progress: number, message?: string) => void;

export interface SlicerBackend {
  /** Slice a model and return GCode + stats. */
  loadAndSlice(
    input: ArrayBuffer,
    config: Record<string, string>,
    format: 'stl' | '3mf',
    onProgress?: ProgressCallback,
  ): Promise<SliceResult>;
  /** Slice a multi-object build plate and return GCode + stats. */
  slicePlate(
    objects: PlateObjectMsg[],
    globalConfig: Record<string, string>,
    printSequence?: string,
    onProgress?: ProgressCallback,
  ): Promise<SliceResult>;
  /**
   * Query resolved config values from the slicer engine after slicing.
   * Returns resolved values for "auto" fields (value=0) and other config keys.
   * Must be called after a successful slice — returns empty object otherwise.
   */
  getResolvedConfigs(keys: string[]): Promise<Record<string, string>>;
  /** Cancel an in-flight slicing operation (best-effort). */
  cancel(): void;
  /** Release resources. The backend cannot be used after this. */
  destroy(): void;
  /** Human-readable engine name for UI display (e.g. "WASM", "Native ARM"). */
  readonly engineName: string;
}

// ---------------------------------------------------------------------------
// WASM backend (Web Worker)
// ---------------------------------------------------------------------------

class WasmSlicerBackend implements SlicerBackend {
  readonly engineName = 'WASM';
  private worker: Worker | null = null;
  private pending: {
    resolve: (result: SliceResult) => void;
    reject: (error: Error) => void;
  } | null = null;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(
      new URL('../workers/slicer-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.worker = worker;
    return worker;
  }

  loadAndSlice(
    input: ArrayBuffer,
    config: Record<string, string>,
    format: 'stl' | '3mf',
    onProgress?: ProgressCallback,
  ): Promise<SliceResult> {
    // Reject any in-flight operation
    if (this.pending) {
      this.pending.reject(new Error('Superseded by new slice request'));
      this.pending = null;
    }

    const worker = this.getWorker();

    return new Promise<SliceResult>((resolve, reject) => {
      this.pending = { resolve, reject };

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.progress, msg.message);
        } else if (msg.type === 'done') {
          this.pending = null;
          resolve({
            gcode: msg.gcode,
            printTime: msg.nativeStats?.printTime ?? msg.stats?.printTime,
            filamentUsed: msg.stats?.filamentUsed,
            stats: msg.nativeStats ?? undefined,
            resolvedConfigs: msg.resolvedConfigs ?? undefined,
            engineName: msg.engineName ?? undefined,
          });
        } else if (msg.type === 'error') {
          this.pending = null;
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        const message = e.message || 'Worker crashed';
        this.pending = null;
        this.worker = null; // Dead worker — recreate on retry
        reject(new Error(message));
      };

      if (format === '3mf') {
        worker.postMessage(
          { type: 'slice3mf', data: input, config },
          [input],
        );
      } else {
        worker.postMessage(
          { type: 'slice', stlData: input, config },
          [input],
        );
      }
    });
  }

  slicePlate(
    objects: PlateObjectMsg[],
    globalConfig: Record<string, string>,
    printSequence?: string,
    onProgress?: ProgressCallback,
  ): Promise<SliceResult> {
    // Reject any in-flight operation
    if (this.pending) {
      this.pending.reject(new Error('Superseded by new slice request'));
      this.pending = null;
    }

    const worker = this.getWorker();

    return new Promise<SliceResult>((resolve, reject) => {
      this.pending = { resolve, reject };

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.stage, msg.progress, msg.message);
        } else if (msg.type === 'done') {
          this.pending = null;
          resolve({
            gcode: msg.gcode,
            printTime: msg.nativeStats?.printTime ?? msg.stats?.printTime,
            filamentUsed: msg.stats?.filamentUsed,
            stats: msg.nativeStats ?? undefined,
            resolvedConfigs: msg.resolvedConfigs ?? undefined,
            engineName: msg.engineName ?? undefined,
          });
        } else if (msg.type === 'error') {
          this.pending = null;
          reject(new Error(msg.message));
        }
      };

      worker.onerror = (e: ErrorEvent) => {
        const message = e.message || 'Worker crashed';
        this.pending = null;
        this.worker = null;
        reject(new Error(message));
      };

      // Clone object data buffers before transfer so originals stay valid
      // (the canvas still references them for rendering)
      const clonedObjects = objects.map(obj => ({
        ...obj,
        data: obj.data.slice(0),
      }));
      const transfers = clonedObjects.map(obj => obj.data);
      worker.postMessage(
        { type: 'slicePlate', objects: clonedObjects, globalConfig, printSequence },
        transfers,
      );
    });
  }

  getResolvedConfigs(keys: string[]): Promise<Record<string, string>> {
    if (!this.worker) {
      return Promise.resolve({});
    }

    const worker = this.worker;

    return new Promise<Record<string, string>>((resolve) => {
      const prevHandler = worker.onmessage;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'resolvedConfigs') {
          // Restore previous handler and resolve
          worker.onmessage = prevHandler;
          resolve(msg.configs ?? {});
        } else if (prevHandler) {
          // Forward other messages (e.g. progress) to the normal handler
          prevHandler.call(worker, e);
        }
      };

      worker.postMessage({ type: 'getResolvedConfigs', keys });
    });
  }

  cancel(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel' });
    }
    if (this.pending) {
      this.pending.reject(new Error('Slicing cancelled'));
      this.pending = null;
    }
  }

  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.pending) {
      this.pending.reject(new Error('Backend destroyed'));
      this.pending = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Native Android backend
// ---------------------------------------------------------------------------

class NativeSlicerBackend implements SlicerBackend {
  readonly engineName: string;
  private activeCallbackId: string | null = null;

  constructor() {
    this.engineName = getNativeEngineName() || 'Native ARM';
  }

  loadAndSlice(
    input: ArrayBuffer,
    config: Record<string, string>,
    format: 'stl' | '3mf',
    onProgress?: ProgressCallback,
  ): Promise<SliceResult> {
    return nativeSlice(input, config, format, onProgress).then(result => {
      this.activeCallbackId = null;
      return result;
    });
  }

  slicePlate(
    _objects: PlateObjectMsg[],
    _globalConfig: Record<string, string>,
    _printSequence?: string,
    _onProgress?: ProgressCallback,
  ): Promise<SliceResult> {
    return Promise.reject(new Error('Multi-object plate slicing is not supported on the native Android backend'));
  }

  getResolvedConfigs(_keys: string[]): Promise<Record<string, string>> {
    // Native backend doesn't support resolved config queries yet
    return Promise.resolve({});
  }

  cancel(): void {
    if (this.activeCallbackId) {
      nativeCancelSlice(this.activeCallbackId);
      this.activeCallbackId = null;
    }
  }

  destroy(): void {
    this.cancel();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the best available slicer backend.
 * Returns NativeSlicerBackend on Android with JNI library loaded,
 * WasmSlicerBackend otherwise.
 */
export function createSlicerBackend(): SlicerBackend {
  if (isNativeSlicerAvailable()) {
    return new NativeSlicerBackend();
  }
  return new WasmSlicerBackend();
}
