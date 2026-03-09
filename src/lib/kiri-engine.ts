/**
 * Vite-compatible wrapper for the Kiri:Moto slicing engine.
 *
 * This module handles:
 * - Creating the slicer web worker using Vite's worker bundling
 * - Injecting the worker into Kiri's engine via setWorkerFactory()
 * - Re-exporting the Engine class with a convenient factory function
 *
 * Usage:
 *   import { createSlicerEngine } from './kiri-engine';
 *   const engine = createSlicerEngine();
 *   await engine.parse(stlArrayBuffer);
 *   engine.setProcess({ sliceHeight: 0.2 });
 *   await engine.slice();
 *   await engine.prepare();
 *   const gcode = await engine.export();
 */

// THREE must be initialized globally before any Kiri modules that use it as a bare global
import '../../vendor/kiri-engine/src/add/three.js';
// @ts-expect-error — vendored JS module, no type declarations
import { client } from '../../vendor/kiri-engine/src/kiri/app/workers.js';
// @ts-expect-error — vendored JS module, no type declarations
import { Engine } from '../../vendor/kiri-engine/src/kiri/run/engine.js';

export interface MultiColorMesh {
  /** Float32Array of vertex positions (x,y,z triples, 9 per triangle) */
  vertices: Float32Array;
  /** Extruder index for this mesh (0-based) */
  extruder: number;
}

export interface SlicerEngine {
  parse(data: ArrayBuffer): Promise<SlicerEngine>;
  parseMultiColor(meshes: MultiColorMesh[]): SlicerEngine;
  load(url: string): Promise<SlicerEngine>;
  clear(): void;
  setListener(listener: (event: unknown) => void): SlicerEngine;
  setRender(bool: boolean): SlicerEngine;
  setMode(mode: 'FDM' | 'CAM' | 'LASER' | 'SLA'): SlicerEngine;
  setDevice(device: Record<string, unknown>): SlicerEngine;
  setProcess(process: Record<string, unknown>): SlicerEngine;
  setController(controller: Record<string, unknown>): SlicerEngine;
  setTools(tools: unknown[]): SlicerEngine;
  setThreading(bool: boolean): void;
  moveTo(x: number, y: number, z: number): SlicerEngine;
  move(x: number, y: number, z: number): SlicerEngine;
  scale(x: number, y: number, z: number): SlicerEngine;
  rotate(x: number, y: number, z: number): SlicerEngine;
  slice(): Promise<SlicerEngine>;
  prepare(): Promise<SlicerEngine>;
  export(): Promise<string>;
  settings: {
    mode: string;
    controller: Record<string, unknown>;
    render: boolean;
    filter: Record<string, string>;
    device: Record<string, unknown>;
    process: Record<string, unknown>;
    widget: Record<string, unknown>;
    tools?: unknown[];
  };
}

function createWorker(): Worker {
  const worker = new Worker(
    new URL('../workers/kiri-worker.js', import.meta.url),
    { type: 'module' }
  );
  worker.onerror = (error) => {
    console.error('[kiri-worker] error:', error);
  };
  worker.onmessageerror = (error) => {
    console.error('[kiri-worker] message error:', error);
  };
  return worker;
}

/**
 * Create a new Kiri:Moto slicing engine instance.
 *
 * The engine provides a chainable API:
 *   engine.parse(buffer)     — load STL binary data
 *   engine.setDevice({...})  — set printer dimensions, speeds
 *   engine.setProcess({...}) — set slicing parameters (layer height, infill, etc.)
 *   engine.slice()           — slice the model (async)
 *   engine.prepare()         — generate toolpaths (async)
 *   engine.export()          — generate gcode string (async)
 */
export function createSlicerEngine(): SlicerEngine {
  // Inject our Vite-bundled worker factory before Engine constructor calls client.restart()
  client.setWorkerFactory(createWorker);
  return new Engine() as SlicerEngine;
}

export { Engine, client };
