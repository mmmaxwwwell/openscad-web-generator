// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * React hook wrapping the slicer engine via a Web Worker.
 *
 * Provides a lazy-initialized slicer that converts STL/3MF data to GCode.
 * The worker is created on the first slice() call and reused for subsequent calls.
 * The WASM module is loaded inside the worker (heavy, ~15-20MB).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type SlicerStatus = 'idle' | 'loading' | 'ready' | 'slicing' | 'error';

export interface SliceProgress {
  stage: 'parsing' | 'slicing' | 'preparing' | 'exporting';
  /** 0-1 progress within the current stage */
  progress: number;
  message?: string;
}

export interface SliceResult {
  gcode: string;
  /** Estimated print time in seconds */
  printTime?: number;
  /** Filament used in mm (parsed from gcode comments) */
  filamentUsed?: number;
}

export interface UseSlicerResult {
  /** Current status of the slicer engine */
  status: SlicerStatus;
  /** Error message if status is 'error' */
  error: string | null;
  /** Current slicing progress */
  progress: SliceProgress | null;
  /** Debug log entries (most recent last) */
  debugLog: string[];
  /**
   * Slice an STL buffer into GCode.
   * @param stlData - Binary STL data as ArrayBuffer (used for single-color)
   * @param config - PrusaSlicer config key/value pairs
   * @param threeMfData - Optional 3MF buffer for multi-color (PrusaSlicer handles extruder assignment from 3MF metadata)
   */
  slice: (
    stlData: ArrayBuffer,
    config?: Record<string, string>,
    threeMfData?: ArrayBuffer,
  ) => Promise<SliceResult>;
  /** Cancel an in-flight slicing operation */
  cancel: () => void;
  /** Reset the slicer (clears error state, creates fresh engine on next slice) */
  reset: () => void;
}

/** Parse print stats from gcode comments */
export function parseGcodeStats(gcode: string): { printTime?: number; filamentUsed?: number } {
  // PrusaSlicer format
  const psTimeMatch = gcode.match(/; estimated printing time \(normal mode\) = (?:(\d+)h )?(?:(\d+)m )?(?:(\d+)s)?/);
  const psFilamentMatch = gcode.match(/; filament used \[mm\] = ([\d.]+)/);
  let printTime: number | undefined;
  if (psTimeMatch) {
    const h = parseInt(psTimeMatch[1] || '0', 10);
    const m = parseInt(psTimeMatch[2] || '0', 10);
    const s = parseInt(psTimeMatch[3] || '0', 10);
    printTime = h * 3600 + m * 60 + s;
  }
  return {
    printTime,
    filamentUsed: psFilamentMatch ? parseFloat(psFilamentMatch[1]) : undefined,
  };
}

/**
 * Map worker progress stages to the SliceProgress stage names used by the UI.
 *
 * Worker stages (from slicer-worker.ts):
 *   loading, loading_model → parsing (loading WASM + parsing model data)
 *   configuring, slicing    → slicing (apply config + PrusaSlicer process)
 *   exporting               → exporting (GCode generation)
 */
function mapWorkerStage(workerStage: string): SliceProgress['stage'] {
  switch (workerStage) {
    case 'loading':
    case 'loading_model':
      return 'parsing';
    case 'configuring':
    case 'slicing':
      return 'slicing';
    case 'exporting':
      return 'exporting';
    default:
      return 'slicing';
  }
}

export function useSlicer(): UseSlicerResult {
  const [status, setStatus] = useState<SlicerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SliceProgress | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  const mountedRef = useRef(true);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{
    resolve: (result: SliceResult) => void;
    reject: (error: Error) => void;
  } | null>(null);

  // Track mounted state for safe setState calls
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Terminate worker on unmount
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      // Reject any pending slice
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('Component unmounted'));
        pendingRef.current = null;
      }
    };
  }, []);

  /** Create the worker lazily on first use */
  const getWorker = useCallback((): Worker => {
    if (workerRef.current) return workerRef.current;

    const worker = new Worker(
      new URL('../workers/slicer-worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (!mountedRef.current) return;

      if (msg.type === 'progress') {
        const stage = mapWorkerStage(msg.stage);
        setProgress({ stage, progress: msg.progress, message: msg.message });
        const logEntry = msg.message
          ? `[${msg.stage}] ${msg.message}`
          : `[${msg.stage}] ${Math.round(msg.progress * 100)}%`;
        setDebugLog(prev => [...prev, logEntry]);
      } else if (msg.type === 'done') {
        setStatus('ready');
        setProgress(null);
        const result: SliceResult = {
          gcode: msg.gcode,
          printTime: msg.stats?.printTime,
          filamentUsed: msg.stats?.filamentUsed,
        };
        pendingRef.current?.resolve(result);
        pendingRef.current = null;
      } else if (msg.type === 'error') {
        setStatus('error');
        setError(msg.message);
        setProgress(null);
        setDebugLog(prev => [...prev, `ERROR: ${msg.message}`]);
        pendingRef.current?.reject(new Error(msg.message));
        pendingRef.current = null;
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      if (!mountedRef.current) return;
      const message = e.message || 'Worker crashed';
      setStatus('error');
      setError(message);
      setProgress(null);
      setDebugLog(prev => [...prev, `WORKER ERROR: ${message}`]);
      pendingRef.current?.reject(new Error(message));
      pendingRef.current = null;
      // Worker is dead — clear ref so a new one is created on retry
      workerRef.current = null;
    };

    workerRef.current = worker;
    return worker;
  }, []);

  const slice = useCallback(async (
    stlData: ArrayBuffer,
    config?: Record<string, string>,
    threeMfData?: ArrayBuffer,
  ): Promise<SliceResult> => {
    // Reject any in-flight operation
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Superseded by new slice request'));
      pendingRef.current = null;
    }

    if (mountedRef.current) {
      setStatus('slicing');
      setError(null);
      setProgress({ stage: 'parsing', progress: 0 });
      setDebugLog([]);
    }

    const worker = getWorker();

    return new Promise<SliceResult>((resolve, reject) => {
      pendingRef.current = { resolve, reject };

      if (threeMfData) {
        // Multi-color: pass the 3MF buffer directly — PrusaSlicer handles
        // extruder assignment internally from 3MF metadata.
        worker.postMessage(
          { type: 'slice3mf', data: threeMfData, config: config || {} },
          [threeMfData],
        );
      } else {
        // Single-color: pass the STL buffer
        worker.postMessage(
          { type: 'slice', stlData, config: config || {} },
          [stlData],
        );
      }
    });
  }, [getWorker]);

  const cancel = useCallback(() => {
    const worker = workerRef.current;
    if (worker) {
      worker.postMessage({ type: 'cancel' });
    }
    if (mountedRef.current) {
      setStatus('idle');
      setProgress(null);
    }
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Slicing cancelled'));
      pendingRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    // Terminate the current worker so a fresh one is created on next slice
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Slicer reset'));
      pendingRef.current = null;
    }
    setStatus('idle');
    setError(null);
    setProgress(null);
    setDebugLog([]);
  }, []);

  return { status, error, progress, debugLog, slice, cancel, reset };
}
