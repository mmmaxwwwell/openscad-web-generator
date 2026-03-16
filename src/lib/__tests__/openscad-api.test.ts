// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectParameters, createOpenSCADApi } from '../openscad-api';
import type { WorkerResponse } from '../openscad-worker';

// Mock Worker
class MockWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  // Test helper: simulate the worker sending a message back
  simulateMessage(data: WorkerResponse) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  simulateError(message: string) {
    this.onerror?.({ message } as ErrorEvent);
  }
}

let mockWorkerInstance: MockWorker;

vi.stubGlobal('Worker', class {
  constructor() {
    mockWorkerInstance = new MockWorker();
    return mockWorkerInstance as any;
  }
});

// Suppress console output in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

describe('injectParameters', () => {
  it('returns source unchanged when no params', () => {
    const source = 'cube([10,10,10]);';
    expect(injectParameters(source, {})).toBe(source);
  });

  it('appends number parameter', () => {
    const result = injectParameters('cube();', { width: 20 });
    expect(result).toBe('cube();\n\nwidth = 20;\n');
  });

  it('appends string parameter with proper escaping', () => {
    const result = injectParameters('cube();', { label: 'say "hi"' });
    expect(result).toBe('cube();\n\nlabel = "say \\"hi\\"";\n');
  });

  it('appends boolean parameter', () => {
    const result = injectParameters('cube();', { center: true });
    expect(result).toBe('cube();\n\ncenter = true;\n');
  });

  it('appends vector parameter', () => {
    const result = injectParameters('cube();', { dims: [10, 20, 30] });
    expect(result).toBe('cube();\n\ndims = [10, 20, 30];\n');
  });

  it('appends multiple parameters', () => {
    const result = injectParameters('cube();', { width: 10, height: 20 });
    expect(result).toContain('width = 10;');
    expect(result).toContain('height = 20;');
    expect(result.startsWith('cube();')).toBe(true);
  });

  it('escapes backslashes in strings', () => {
    const result = injectParameters('cube();', { path: 'C:\\Users' });
    expect(result).toBe('cube();\n\npath = "C:\\\\Users";\n');
  });

  it('escapes newlines in strings', () => {
    const result = injectParameters('cube();', { text: 'line1\nline2' });
    expect(result).toBe('cube();\n\ntext = "line1\\nline2";\n');
  });

  it('rejects invalid parameter names', () => {
    const result = injectParameters('cube();', { '123bad': 42, 'good_name': 1 });
    expect(result).toContain('good_name = 1;');
    expect(result).not.toContain('123bad');
  });

  it('handles false boolean', () => {
    const result = injectParameters('cube();', { center: false });
    expect(result).toBe('cube();\n\ncenter = false;\n');
  });

  it('returns source unchanged when all param names are invalid', () => {
    const result = injectParameters('cube();', { '123': 1, '!bad': 2 });
    expect(result).toBe('cube();');
  });

  it('handles non-primitive values via String() fallback', () => {
    // e.g. null, undefined, or other types that don't match number/boolean/string/array
    const result = injectParameters('cube();', { x: null as any });
    expect(result).toContain('x = null;');
  });
});

describe('createOpenSCADApi', () => {
  let api: ReturnType<typeof createOpenSCADApi>;

  beforeEach(() => {
    api = createOpenSCADApi();
  });

  describe('init', () => {
    it('resolves on successful init', async () => {
      const promise = api.init();
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'init',
        id,
        success: true,
      });

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects on failed init', async () => {
      const promise = api.init();
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'init',
        id,
        success: false,
        error: 'WASM load failed',
      });

      await expect(promise).rejects.toThrow('WASM load failed');
    });

    it('rejects with default message when error is undefined', async () => {
      const promise = api.init();
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'init',
        id,
        success: false,
      });

      await expect(promise).rejects.toThrow('WASM init failed');
    });
  });

  describe('render', () => {
    it('resolves with output on success', async () => {
      const output = new ArrayBuffer(8);
      const promise = api.render('cube();', 'stl');
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'render',
        id,
        scadSource: 'cube();',
        outputFormat: 'stl',
      });

      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output,
      });

      await expect(promise).resolves.toBe(output);
    });

    it('rejects with error and logs on failure', async () => {
      const promise = api.render('bad();', 'stl');
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'error',
        id,
        error: 'Syntax error',
        logs: ['line 1: unexpected token'],
      });

      try {
        await promise;
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).toBe('Syntax error');
        expect(err.logs).toEqual(['line 1: unexpected token']);
      }
    });

    it('rejects with error and empty logs', async () => {
      const promise = api.render('bad();', 'stl');
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'error',
        id,
        error: 'Unknown error',
        logs: [],
      });

      await expect(promise).rejects.toThrow('Unknown error');
    });

    it('calls onLog callback for log messages', async () => {
      const onLog = vi.fn();
      const promise = api.render('cube();', 'stl', onLog);
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'log',
        id,
        logs: ['Compiling...', 'Rendering...'],
      });

      expect(onLog).toHaveBeenCalledTimes(2);
      expect(onLog).toHaveBeenCalledWith('Compiling...');
      expect(onLog).toHaveBeenCalledWith('Rendering...');

      // Complete the render
      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output: new ArrayBuffer(4),
      });

      await promise;
    });

    it('ignores log messages without callback', async () => {
      const promise = api.render('cube();', 'stl');
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      // Should not throw
      mockWorkerInstance.simulateMessage({
        type: 'log',
        id,
        logs: ['Compiling...'],
      });

      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output: new ArrayBuffer(4),
      });

      await promise;
    });
  });

  describe('renderMulticolor', () => {
    it('sends render-multicolor request and resolves', async () => {
      const output = new ArrayBuffer(16);
      const promise = api.renderMulticolor('color("red") cube();');
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith({
        type: 'render-multicolor',
        id,
        scadSource: 'color("red") cube();',
      });

      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output,
      });

      await expect(promise).resolves.toBe(output);
    });

    it('calls onLog callback for multicolor render', async () => {
      const onLog = vi.fn();
      const promise = api.renderMulticolor('cube();', onLog);
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'log',
        id,
        logs: ['Processing colors...'],
      });

      expect(onLog).toHaveBeenCalledWith('Processing colors...');

      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output: new ArrayBuffer(4),
      });

      await promise;
    });
  });

  describe('dispose', () => {
    it('terminates worker and rejects pending requests', async () => {
      const promise1 = api.init();
      const promise2 = api.render('cube();', 'stl');

      api.dispose();

      expect(mockWorkerInstance.terminate).toHaveBeenCalled();
      await expect(promise1).rejects.toThrow('Worker terminated');
      await expect(promise2).rejects.toThrow('Worker terminated');
    });
  });

  describe('worker.onerror', () => {
    it('rejects all pending requests on worker error', async () => {
      const promise1 = api.init();
      const promise2 = api.render('cube();', 'stl');

      mockWorkerInstance.simulateError('Script error');

      await expect(promise1).rejects.toThrow('Worker error: Script error');
      await expect(promise2).rejects.toThrow('Worker error: Script error');
    });
  });

  describe('message handling edge cases', () => {
    it('ignores messages with unknown id', () => {
      // Should not throw
      mockWorkerInstance.simulateMessage({
        type: 'success',
        id: 'nonexistent',
        output: new ArrayBuffer(0),
      });
    });

    it('ignores log messages with unknown id', () => {
      // Should not throw
      mockWorkerInstance.simulateMessage({
        type: 'log',
        id: 'nonexistent',
        logs: ['stray log'],
      });
    });

    it('cleans up logCallbacks after request completes', async () => {
      const onLog = vi.fn();
      const promise = api.render('cube();', 'stl', onLog);
      const id = mockWorkerInstance.postMessage.mock.calls[0][0].id;

      mockWorkerInstance.simulateMessage({
        type: 'success',
        id,
        output: new ArrayBuffer(4),
      });

      await promise;

      // After completion, log messages for this id should be ignored
      mockWorkerInstance.simulateMessage({
        type: 'log',
        id,
        logs: ['late log'],
      });

      expect(onLog).not.toHaveBeenCalled();
    });
  });
});
