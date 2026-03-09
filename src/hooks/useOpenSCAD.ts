/**
 * React hook wrapping the OpenSCAD WASM API.
 *
 * Manages the worker lifecycle, provides render methods,
 * and exposes loading/error state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOpenSCADApi,
  injectParameters,
  type OpenSCADApi,
  type OutputFormat,
} from '../lib/openscad-api';
import type { ScadValue } from '../types';

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
  /** Render scad source to multi-color 3MF. */
  renderMulticolor: (
    source: string,
    params: Record<string, ScadValue>,
  ) => Promise<ArrayBuffer>;
}

export function useOpenSCAD(): UseOpenSCADResult {
  const apiRef = useRef<OpenSCADApi | null>(null);
  const [status, setStatus] = useState<OpenSCADStatus>('idle');
  const statusRef = useRef<OpenSCADStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const mountedRef = useRef(true);

  // Keep statusRef in sync so callbacks always see the latest value
  const updateStatus = useCallback((s: OpenSCADStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const ensureApi = useCallback(() => {
    if (!apiRef.current) {
      apiRef.current = createOpenSCADApi();
    }
    return apiRef.current;
  }, []);

  // Create API on mount, dispose on unmount
  useEffect(() => {
    mountedRef.current = true;
    ensureApi();
    return () => {
      mountedRef.current = false;
      apiRef.current?.dispose();
      apiRef.current = null;
    };
  }, [ensureApi]);

  // Replace a crashed worker with a fresh one
  const resetWorker = useCallback(() => {
    console.log('[useOpenSCAD] Resetting worker after crash');
    apiRef.current?.dispose();
    apiRef.current = null;
  }, []);

  const init = useCallback(async () => {
    const api = ensureApi();

    updateStatus('loading');
    setError(null);
    try {
      await api.init();
      if (mountedRef.current) updateStatus('ready');
    } catch (err: any) {
      console.error('[useOpenSCAD] Init failed:', err);
      if (mountedRef.current) {
        updateStatus('error');
        setError(err?.message ?? 'Failed to initialize OpenSCAD');
      }
    }
  }, [ensureApi, updateStatus]);

  const render = useCallback(async (
    source: string,
    params: Record<string, ScadValue>,
    format: OutputFormat,
  ): Promise<ArrayBuffer> => {
    const currentStatus = statusRef.current;

    // Auto-init if needed (also retry after errors)
    if (currentStatus === 'idle' || currentStatus === 'error') {
      // After an error the WASM instance may be corrupted — start fresh
      if (currentStatus === 'error') resetWorker();
      await init();
    }

    // Read the API ref *after* potential resetWorker/init so we use the fresh worker
    const api = ensureApi();

    updateStatus('rendering');
    setError(null);
    setLogs([]);
    try {
      const injected = injectParameters(source, params);
      const result = await api.render(injected, format, (line) => {
        if (mountedRef.current) setLogs((prev) => [...prev, line]);
      });
      if (mountedRef.current) updateStatus('ready');
      return result;
    } catch (err: any) {
      console.error('[useOpenSCAD] Render failed:', err);
      if (err.logs?.length) {
        console.error('[useOpenSCAD] OpenSCAD logs:\n' + err.logs.join('\n'));
      }
      if (mountedRef.current) {
        updateStatus('error');
        const msg = err?.message ?? 'Render failed';
        setError(msg);
        if (err.logs) setLogs(err.logs);
      }
      throw err;
    }
  }, [init, ensureApi, resetWorker, updateStatus]);

  const renderMulticolor = useCallback(async (
    source: string,
    params: Record<string, ScadValue>,
  ): Promise<ArrayBuffer> => {
    const currentStatus = statusRef.current;

    if (currentStatus === 'idle' || currentStatus === 'error') {
      if (currentStatus === 'error') resetWorker();
      await init();
    }

    const api = ensureApi();

    updateStatus('rendering');
    setError(null);
    setLogs([]);
    try {
      const injected = injectParameters(source, params);
      const result = await api.renderMulticolor(injected, (line) => {
        if (mountedRef.current) setLogs((prev) => [...prev, line]);
      });
      if (mountedRef.current) updateStatus('ready');
      return result;
    } catch (err: any) {
      console.error('[useOpenSCAD] Multicolor render failed:', err);
      if (mountedRef.current) {
        updateStatus('error');
        const msg = err?.message ?? 'Multicolor render failed';
        setError(msg);
        if (err.logs) setLogs(err.logs);
      }
      throw err;
    }
  }, [init, ensureApi, resetWorker, updateStatus]);

  return { status, error, logs, init, render, renderMulticolor };
}
