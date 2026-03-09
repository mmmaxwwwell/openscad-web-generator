/**
 * Vite-compatible entry point for the Kiri:Moto slicer worker.
 * This file exists so Vite can statically analyze the worker import
 * via `new Worker(new URL('./kiri-worker.js', import.meta.url), {type: 'module'})`.
 *
 * It simply re-exports the vendored worker which sets up self.onmessage.
 */
import '../../vendor/kiri-engine/src/kiri/run/worker.js';
