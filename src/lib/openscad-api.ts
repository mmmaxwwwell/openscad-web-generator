/**
 * Main-thread API for communicating with the OpenSCAD Web Worker.
 *
 * Provides promise-based wrappers around postMessage calls.
 */

import type { ScadValue } from '../types';
import type { WorkerRequest, WorkerResponse } from './openscad-worker';

export type OutputFormat = 'stl' | '3mf';

export interface OpenSCADApi {
  /** Initialize the WASM module (can be called eagerly for preloading). */
  init(): Promise<void>;

  /** Render scad source to STL or 3MF, returns the file bytes. */
  render(scadSource: string, format: OutputFormat, onLog?: (line: string) => void): Promise<ArrayBuffer>;

  /** Render scad source to multi-color 3MF, returns the merged file bytes. */
  renderMulticolor(scadSource: string, onLog?: (line: string) => void): Promise<ArrayBuffer>;

  /** Terminate the worker. */
  dispose(): void;
}

let requestId = 0;
function nextId(): string {
  return String(++requestId);
}

/**
 * Prepend parameter overrides to scad source.
 *
 * Generates lines like:
 *   width = 20;
 *   label = "hello";
 *   center = true;
 *   dims = [10, 20, 30];
 */
export function injectParameters(source: string, params: Record<string, ScadValue>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return source;

  // Append after source so overrides win (OpenSCAD uses last-assignment-wins)
  const lines = entries.map(([name, value]) => `${name} = ${formatScadValue(value)};`);
  return source + '\n\n' + lines.join('\n') + '\n';
}

function formatScadValue(value: ScadValue): string {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
}

export function createOpenSCADApi(): OpenSCADApi {
  const worker = new Worker(
    new URL('./openscad-worker.ts', import.meta.url),
    { type: 'module' },
  );

  const pending = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }>();

  const logCallbacks = new Map<string, (line: string) => void>();

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'log') {
      const cb = logCallbacks.get(msg.id);
      if (cb) {
        for (const line of msg.logs) cb(line);
      }
      return;
    }

    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    logCallbacks.delete(msg.id);

    if (msg.type === 'init') {
      if (msg.success) {
        console.log('[OpenSCAD] WASM initialized successfully');
        entry.resolve(undefined);
      } else {
        console.error('[OpenSCAD] WASM init failed:', msg.error);
        entry.reject(new Error(msg.error ?? 'WASM init failed'));
      }
    } else if (msg.type === 'success') {
      console.log('[OpenSCAD] Render succeeded');
      entry.resolve(msg.output);
    } else if (msg.type === 'error') {
      console.error('[OpenSCAD] Render error:', msg.error);
      if (msg.logs.length > 0) {
        console.error('[OpenSCAD] Logs:\n' + msg.logs.join('\n'));
      }
      const err = new Error(msg.error);
      (err as any).logs = msg.logs;
      entry.reject(err);
    }
  };

  worker.onerror = (e) => {
    console.error('[OpenSCAD] Worker error:', e.message);
    // Reject all pending requests
    const err = new Error(`Worker error: ${e.message}`);
    for (const entry of pending.values()) {
      entry.reject(err);
    }
    pending.clear();
  };

  function send<T>(request: WorkerRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      worker.postMessage(request);
    });
  }

  return {
    async init() {
      await send<void>({ type: 'init', id: nextId() });
    },

    async render(scadSource: string, format: OutputFormat, onLog?: (line: string) => void) {
      const id = nextId();
      if (onLog) logCallbacks.set(id, onLog);
      return send<ArrayBuffer>({
        type: 'render',
        id,
        scadSource,
        outputFormat: format,
      });
    },

    async renderMulticolor(scadSource: string, onLog?: (line: string) => void) {
      const id = nextId();
      if (onLog) logCallbacks.set(id, onLog);
      return send<ArrayBuffer>({
        type: 'render-multicolor',
        id,
        scadSource,
      });
    },

    dispose() {
      worker.terminate();
      for (const entry of pending.values()) {
        entry.reject(new Error('Worker terminated'));
      }
      pending.clear();
    },
  };
}
