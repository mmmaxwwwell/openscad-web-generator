/**
 * Main-thread API for communicating with the OpenSCAD Web Worker.
 *
 * Provides promise-based wrappers around postMessage calls.
 */

import type { ScadValue, ScadViewpoint } from '../types';
import type { WorkerRequest, WorkerResponse } from './openscad-worker';

export type OutputFormat = 'stl' | '3mf';

export interface OpenSCADApi {
  /** Initialize the WASM module (can be called eagerly for preloading). */
  init(): Promise<void>;

  /** Render scad source to STL or 3MF, returns the file bytes. */
  render(scadSource: string, format: OutputFormat): Promise<ArrayBuffer>;

  /** Generate a PNG preview for a given viewpoint, returns PNG bytes. */
  preview(scadSource: string, viewpoint: ScadViewpoint, imgSize?: [number, number]): Promise<ArrayBuffer>;

  /** Terminate the worker. */
  dispose(): void;
}

let requestId = 0;
function nextId(): string {
  return String(++requestId);
}

/**
 * Build a camera argument string for OpenSCAD's --camera flag.
 *
 * File format:  rotX,rotY,rotZ,transX,transY,transZ,distance
 * CLI expects:  transX,transY,transZ,rotX,rotY,rotZ,distance
 */
export function viewpointToCameraArg(vp: ScadViewpoint): string {
  return `${vp.transX},${vp.transY},${vp.transZ},${vp.rotX},${vp.rotY},${vp.rotZ},${vp.distance}`;
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

  const lines = entries.map(([name, value]) => `${name} = ${formatScadValue(value)};`);
  return lines.join('\n') + '\n\n' + source;
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

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    if (msg.type === 'log') return; // informational, no pending promise

    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);

    if (msg.type === 'init') {
      if (msg.success) entry.resolve(undefined);
      else entry.reject(new Error(msg.error ?? 'WASM init failed'));
    } else if (msg.type === 'success') {
      entry.resolve(msg.output);
    } else if (msg.type === 'error') {
      const err = new Error(msg.error);
      (err as any).logs = msg.logs;
      entry.reject(err);
    }
  };

  worker.onerror = (e) => {
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

    async render(scadSource: string, format: OutputFormat) {
      return send<ArrayBuffer>({
        type: 'render',
        id: nextId(),
        scadSource,
        outputFormat: format,
      });
    },

    async preview(scadSource: string, viewpoint: ScadViewpoint, imgSize?: [number, number]) {
      return send<ArrayBuffer>({
        type: 'preview',
        id: nextId(),
        scadSource,
        cameraArgs: viewpointToCameraArg(viewpoint),
        imgSize,
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
