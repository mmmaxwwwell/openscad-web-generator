/**
 * React hook wrapping the Kiri:Moto slicing engine.
 *
 * Provides a lazy-initialized slicer that converts STL data to GCode.
 * The engine runs its own web worker internally — this hook just
 * manages the lifecycle and exposes status/progress to React.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlicerEngine, MultiColorMesh } from '../lib/kiri-engine';

export type SlicerStatus = 'idle' | 'loading' | 'ready' | 'slicing' | 'error';

export interface SliceProgress {
  stage: 'parsing' | 'slicing' | 'preparing' | 'exporting';
  /** 0-1 progress within the current stage */
  progress: number;
  message?: string;
}

export interface SliceResult {
  gcode: string;
  /** Estimated print time in seconds (from Kiri:Moto) */
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
   * @param stlData - Binary STL data as ArrayBuffer
   * @param processSettings - Kiri:Moto process settings (layer height, infill, etc.)
   * @param deviceSettings - Kiri:Moto device settings (bed size, speeds, etc.)
   * @param tools - Optional multi-extruder tool config
   * @param multiColorMeshes - Optional per-color meshes for multi-material (overrides stlData)
   */
  slice: (
    stlData: ArrayBuffer,
    processSettings?: Record<string, unknown>,
    deviceSettings?: Record<string, unknown>,
    tools?: unknown[],
    multiColorMeshes?: MultiColorMesh[],
  ) => Promise<SliceResult>;
  /** Reset the slicer (clears error state, creates fresh engine on next slice) */
  reset: () => void;
}

/** Parse print stats from Kiri:Moto gcode comments */
function parseGcodeStats(gcode: string): { printTime?: number; filamentUsed?: number } {
  const timeMatch = gcode.match(/; --- print time: (\d+)s ---/);
  const filamentMatch = gcode.match(/; --- filament used: ([\d.]+) mm ---/);
  return {
    printTime: timeMatch ? parseInt(timeMatch[1], 10) : undefined,
    filamentUsed: filamentMatch ? parseFloat(filamentMatch[1]) : undefined,
  };
}

export function useSlicer(): UseSlicerResult {
  const engineRef = useRef<SlicerEngine | null>(null);
  const [status, setStatus] = useState<SlicerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SliceProgress | null>(null);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const mountedRef = useRef(true);

  const addDebug = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setDebugLog(prev => [...prev.slice(-19), `${ts} ${msg}`]);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensureEngine = useCallback(async (): Promise<SlicerEngine> => {
    if (engineRef.current) return engineRef.current;

    if (mountedRef.current) {
      setStatus('loading');
      setError(null);
    }

    // Dynamic import so the ~1.2MB kiri bundle is only loaded when needed
    const { createSlicerEngine } = await import('../lib/kiri-engine');
    const engine = createSlicerEngine();
    engineRef.current = engine;

    if (mountedRef.current) setStatus('ready');
    return engine;
  }, []);

  const slice = useCallback(async (
    stlData: ArrayBuffer,
    processSettings?: Record<string, unknown>,
    deviceSettings?: Record<string, unknown>,
    tools?: unknown[],
    multiColorMeshes?: MultiColorMesh[],
  ): Promise<SliceResult> => {
    setDebugLog([]);
    addDebug(`stlData=${stlData.byteLength}b multi=${multiColorMeshes?.length ?? 'none'}`);
    const engine = await ensureEngine();
    addDebug('engine ready');

    if (mountedRef.current) {
      setStatus('slicing');
      setError(null);
      setProgress({ stage: 'parsing', progress: 0 });
    }

    // Set up progress listener
    engine.setListener((event: unknown) => {
      if (!mountedRef.current) return;
      const evt = event as Record<string, unknown>;

      if (evt.slice) {
        const sliceEvt = evt.slice as Record<string, unknown>;
        if (sliceEvt.error) {
          addDebug(`SLICE ERROR: ${sliceEvt.error}`);
          setProgress({
            stage: 'slicing',
            progress: 0,
            message: `ERROR: ${sliceEvt.error}`,
          });
        } else if (typeof sliceEvt.update === 'number') {
          setProgress({
            stage: 'slicing',
            progress: sliceEvt.update as number,
            message: sliceEvt.updateStatus as string | undefined,
          });
        }
        if (sliceEvt.alert) {
          addDebug(`ALERT: ${sliceEvt.alert}`);
        }
      } else if (evt.prepare) {
        const prepEvt = evt.prepare as Record<string, unknown>;
        if (typeof prepEvt.update === 'number') {
          setProgress({
            stage: 'preparing',
            progress: prepEvt.update as number,
          });
        } else if (prepEvt.done) {
          setProgress({ stage: 'preparing', progress: 1 });
        }
      } else if (evt.export) {
        setProgress({ stage: 'exporting', progress: 0.5 });
      } else {
        // Log any unhandled events
        addDebug(`evt: ${JSON.stringify(evt).slice(0, 120)}`);
      }
    });

    try {
      // Parse mesh data
      if (mountedRef.current) {
        setProgress({ stage: 'parsing', progress: 0.5 });
      }
      if (multiColorMeshes && multiColorMeshes.length > 1) {
        addDebug(`parseMultiColor ${multiColorMeshes.length} meshes`);
        engine.parseMultiColor(multiColorMeshes);
      } else {
        addDebug('parsing STL...');
        await engine.parse(stlData);
      }
      addDebug('parse done');

      // Apply settings
      if (processSettings) {
        addDebug(`setProcess: h=${processSettings.sliceHeight} fill=${processSettings.sliceFillSparse}`);
        engine.setProcess(processSettings);
      }
      if (deviceSettings) {
        addDebug(`setDevice: bed=${deviceSettings.bedWidth}x${deviceSettings.bedDepth} ext=${(deviceSettings.extruders as unknown[])?.length ?? '?'}`);
        engine.setDevice(deviceSettings);
      }
      if (tools) {
        addDebug(`setTools: ${tools.length}`);
        engine.setTools(tools);
      }

      // Slice → Prepare → Export
      addDebug('slice start...');
      if (mountedRef.current) {
        setProgress({ stage: 'slicing', progress: 0 });
      }
      await engine.slice();
      addDebug('slice done');

      addDebug('prepare start...');
      if (mountedRef.current) {
        setProgress({ stage: 'preparing', progress: 0 });
      }
      await engine.prepare();
      addDebug('prepare done');

      addDebug('export start...');
      if (mountedRef.current) {
        setProgress({ stage: 'exporting', progress: 0 });
      }
      const gcode = await engine.export();
      addDebug(`export done: ${gcode.length} chars`);

      const stats = parseGcodeStats(gcode);

      if (mountedRef.current) {
        setStatus('ready');
        setProgress(null);
      }

      return { gcode, ...stats };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`CATCH ERROR: ${message}`);
      if (mountedRef.current) {
        setStatus('error');
        setError(message);
        setProgress(null);
      }
      throw err;
    }
  }, [ensureEngine]);

  const reset = useCallback(() => {
    engineRef.current = null;
    setStatus('idle');
    setError(null);
    setProgress(null);
    setDebugLog([]);
  }, []);

  return { status, error, progress, debugLog, slice, reset };
}
