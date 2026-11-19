// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * React hook wrapping the slicer engine via the SlicerBackend abstraction.
 *
 * Auto-selects the best available backend (Native ARM on Android, WASM otherwise).
 * The backend is created on the first slice() call and reused for subsequent calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSlicerBackend } from '../lib/slicer-backend';
import type { SlicerBackend } from '../lib/slicer-backend';
import type { PlateObjectMsg } from '../workers/slicer-worker';
import type { SliceStats } from '../types/print-profile';

export type SlicerStatus = 'idle' | 'loading' | 'ready' | 'slicing' | 'error';

export interface SliceProgress {
  stage: 'parsing' | 'slicing' | 'preparing' | 'exporting';
  /** 0-1 progress within the current stage */
  progress: number;
  message?: string;
}

export interface SliceResult {
  gcode: string;
  /** Estimated print time in seconds (from GCode parsing or native stats) */
  printTime?: number;
  /** Filament used in mm (parsed from gcode comments) */
  filamentUsed?: number;
  /** Rich print statistics from the slicer engine (available when using native stats API) */
  stats?: SliceStats;
  /** Resolved slicer config values for "auto" fields (available after slicing) */
  resolvedConfigs?: Record<string, string>;
  /** Engine name reported by the worker (e.g. "WASM", "WASM64") — may differ from backend default if OOM retry occurred */
  engineName?: string;
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
  /** Human-readable engine name (e.g. "WASM", "Native ARM") */
  engineName: string;
  /** Rich print statistics from the most recent slice (null before first slice) */
  sliceStats: SliceStats | null;
  /** Resolved slicer config values for "auto" fields from the most recent slice */
  resolvedConfigs: Record<string, string> | null;
  /**
   * Slice an STL buffer into GCode.
   * @param stlData - Binary STL data as ArrayBuffer (used for single-color)
   * @param config - OrcaSlicer config key/value pairs
   * @param threeMfData - Optional 3MF buffer for multi-color
   */
  slice: (
    stlData: ArrayBuffer,
    config?: Record<string, string>,
    threeMfData?: ArrayBuffer,
  ) => Promise<SliceResult>;
  /**
   * Slice a multi-object build plate into GCode.
   * @param objects - Array of plate objects with mesh data, transforms, and per-object config
   * @param globalConfig - OrcaSlicer config key/value pairs for plate-level settings
   * @param printSequence - Optional "by layer" or "by object"
   */
  slicePlate: (
    objects: PlateObjectMsg[],
    globalConfig: Record<string, string>,
    printSequence?: string,
  ) => Promise<SliceResult>;
  /** Query resolved config values from the engine without re-slicing */
  queryResolvedConfigs: (keys: string[]) => Promise<Record<string, string>>;
  /** Cancel an in-flight slicing operation */
  cancel: () => void;
  /** Reset the slicer (clears error state, creates fresh engine on next slice) */
  reset: () => void;
}

/** Parse print stats from gcode comments */
export function parseGcodeStats(gcode: string): { printTime?: number; filamentUsed?: number } {
  // PrusaSlicer/OrcaSlicer format
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
 * Map backend progress stages to the SliceProgress stage names used by the UI.
 *
 * Backend stages:
 *   loading, loading_model → parsing (loading engine + parsing model data)
 *   configuring, slicing    → slicing (apply config + slicer process)
 *   exporting               → exporting (GCode generation)
 */
function mapStage(stage: string): SliceProgress['stage'] {
  switch (stage) {
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
  const [engineName, setEngineName] = useState<string>('WASM');
  const [sliceStats, setSliceStats] = useState<SliceStats | null>(null);
  const [resolvedConfigs, setResolvedConfigs] = useState<Record<string, string> | null>(null);

  const mountedRef = useRef(true);
  const backendRef = useRef<SlicerBackend | null>(null);
  const pendingRef = useRef<{
    resolve: (result: SliceResult) => void;
    reject: (error: Error) => void;
  } | null>(null);

  // Track mounted state for safe setState calls
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Destroy backend on unmount
      if (backendRef.current) {
        backendRef.current.destroy();
        backendRef.current = null;
      }
      // Reject any pending slice
      if (pendingRef.current) {
        pendingRef.current.reject(new Error('Component unmounted'));
        pendingRef.current = null;
      }
    };
  }, []);

  /** Create the backend lazily on first use */
  const getBackend = useCallback((): SlicerBackend => {
    if (backendRef.current) return backendRef.current;

    const backend = createSlicerBackend();
    backendRef.current = backend;
    if (mountedRef.current) {
      setEngineName(backend.engineName);
    }
    return backend;
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

    const backend = getBackend();
    const input = threeMfData || stlData;
    const format = threeMfData ? '3mf' as const : 'stl' as const;

    return new Promise<SliceResult>((resolve, reject) => {
      pendingRef.current = { resolve, reject };

      backend.loadAndSlice(
        input,
        config || {},
        format,
        (stage, prog, message) => {
          if (!mountedRef.current) return;
          const mappedStage = mapStage(stage);
          setProgress({ stage: mappedStage, progress: prog, message });
          const logEntry = message
            ? `[${stage}] ${message}`
            : `[${stage}] ${Math.round(prog * 100)}%`;
          setDebugLog(prev => [...prev, logEntry]);
        },
      ).then(result => {
        if (!mountedRef.current) return;
        setStatus('ready');
        setProgress(null);
        if (result.stats) setSliceStats(result.stats);
        if (result.resolvedConfigs) setResolvedConfigs(result.resolvedConfigs);
        if (result.engineName) setEngineName(result.engineName);
        pendingRef.current = null;
        resolve(result);
      }).catch(err => {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setError(message);
        setProgress(null);
        setDebugLog(prev => [...prev, `ERROR: ${message}`]);
        pendingRef.current = null;
        reject(err);
      });
    });
  }, [getBackend]);

  const slicePlate = useCallback(async (
    objects: PlateObjectMsg[],
    globalConfig: Record<string, string>,
    printSequence?: string,
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

    const backend = getBackend();

    return new Promise<SliceResult>((resolve, reject) => {
      pendingRef.current = { resolve, reject };

      backend.slicePlate(
        objects,
        globalConfig,
        printSequence,
        (stage, prog, message) => {
          if (!mountedRef.current) return;
          const mappedStage = mapStage(stage);
          setProgress({ stage: mappedStage, progress: prog, message });
          const logEntry = message
            ? `[${stage}] ${message}`
            : `[${stage}] ${Math.round(prog * 100)}%`;
          setDebugLog(prev => [...prev, logEntry]);
        },
      ).then(result => {
        if (!mountedRef.current) return;
        setStatus('ready');
        setProgress(null);
        if (result.stats) setSliceStats(result.stats);
        if (result.resolvedConfigs) setResolvedConfigs(result.resolvedConfigs);
        if (result.engineName) setEngineName(result.engineName);
        pendingRef.current = null;
        resolve(result);
      }).catch(err => {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setError(message);
        setProgress(null);
        setDebugLog(prev => [...prev, `ERROR: ${message}`]);
        pendingRef.current = null;
        reject(err);
      });
    });
  }, [getBackend]);

  const cancel = useCallback(() => {
    if (backendRef.current) {
      backendRef.current.cancel();
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

  const queryResolvedConfigs = useCallback(async (keys: string[]): Promise<Record<string, string>> => {
    const backend = backendRef.current;
    if (!backend) return {};
    const configs = await backend.getResolvedConfigs(keys);
    if (mountedRef.current) {
      setResolvedConfigs(prev => prev ? { ...prev, ...configs } : configs);
    }
    return configs;
  }, []);

  const reset = useCallback(() => {
    // Destroy the current backend so a fresh one is created on next slice
    if (backendRef.current) {
      backendRef.current.destroy();
      backendRef.current = null;
    }
    if (pendingRef.current) {
      pendingRef.current.reject(new Error('Slicer reset'));
      pendingRef.current = null;
    }
    setStatus('idle');
    setError(null);
    setProgress(null);
    setDebugLog([]);
    setSliceStats(null);
    setResolvedConfigs(null);
  }, []);

  return {
    status, error, progress, debugLog, engineName,
    sliceStats, resolvedConfigs,
    slice, slicePlate, queryResolvedConfigs, cancel, reset,
  };
}
