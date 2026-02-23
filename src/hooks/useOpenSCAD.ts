/**
 * React hook wrapping the OpenSCAD WASM API.
 *
 * Manages the worker lifecycle, provides render/preview methods,
 * and exposes loading/error state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOpenSCADApi,
  injectParameters,
  type OpenSCADApi,
  type OutputFormat,
} from '../lib/openscad-api';
import type { ScadValue, ScadViewpoint } from '../types';

export type OpenSCADStatus = 'idle' | 'loading' | 'ready' | 'rendering' | 'error';

export interface UseOpenSCADResult {
  /** Current status of the WASM engine. */
  status: OpenSCADStatus;
  /** Error message if status is 'error'. */
  error: string | null;
  /** OpenSCAD log output (stdout + stderr) from the last operation. */
  logs: string[];
  /** Initialize the WASM module (called automatically, but can be called eagerly). */
  init: () => Promise<void>;
  /** Render scad source with parameter overrides to STL or 3MF. */
  render: (
    source: string,
    params: Record<string, ScadValue>,
    format: OutputFormat,
  ) => Promise<ArrayBuffer>;
  /** Generate a PNG preview for a viewpoint. */
  preview: (
    source: string,
    params: Record<string, ScadValue>,
    viewpoint: ScadViewpoint,
    imgSize?: [number, number],
  ) => Promise<ArrayBuffer>;
}

export function useOpenSCAD(): UseOpenSCADResult {
  const apiRef = useRef<OpenSCADApi | null>(null);
  const [status, setStatus] = useState<OpenSCADStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  // Create API on mount, dispose on unmount
  useEffect(() => {
    const api = createOpenSCADApi();
    apiRef.current = api;
    return () => {
      api.dispose();
      apiRef.current = null;
    };
  }, []);

  const init = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;

    setStatus('loading');
    setError(null);
    try {
      await api.init();
      setStatus('ready');
    } catch (err: any) {
      setStatus('error');
      setError(err?.message ?? 'Failed to initialize OpenSCAD');
    }
  }, []);

  const render = useCallback(async (
    source: string,
    params: Record<string, ScadValue>,
    format: OutputFormat,
  ): Promise<ArrayBuffer> => {
    const api = apiRef.current;
    if (!api) throw new Error('OpenSCAD not initialized');

    // Auto-init if needed
    if (status === 'idle') await init();

    setStatus('rendering');
    setError(null);
    setLogs([]);
    try {
      const injected = injectParameters(source, params);
      const result = await api.render(injected, format);
      setStatus('ready');
      return result;
    } catch (err: any) {
      setStatus('error');
      const msg = err?.message ?? 'Render failed';
      setError(msg);
      if (err.logs) setLogs(err.logs);
      throw err;
    }
  }, [status, init]);

  const preview = useCallback(async (
    source: string,
    params: Record<string, ScadValue>,
    viewpoint: ScadViewpoint,
    imgSize?: [number, number],
  ): Promise<ArrayBuffer> => {
    const api = apiRef.current;
    if (!api) throw new Error('OpenSCAD not initialized');

    // Auto-init if needed
    if (status === 'idle') await init();

    setStatus('rendering');
    setError(null);
    setLogs([]);
    try {
      const injected = injectParameters(source, params);
      const result = await api.preview(injected, viewpoint, imgSize);
      setStatus('ready');
      return result;
    } catch (err: any) {
      setStatus('error');
      const msg = err?.message ?? 'Preview failed';
      setError(msg);
      if (err.logs) setLogs(err.logs);
      throw err;
    }
  }, [status, init]);

  return { status, error, logs, init, render, preview };
}
