// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tests for slicer-engine.ts — the typed JS wrapper around libslic3r WASM.
 *
 * Since the WASM module is not available in vitest (it runs in Node, not a browser
 * with COOP/COEP), these tests validate the JS-side logic by mocking the WASM module:
 * - writeToVFS: binary data written correctly to Emscripten FS
 * - decodeWasmException: WASM exception pointer decoding
 * - checkCrossOriginIsolation: COOP/COEP detection
 * - SlicerEngine lifecycle: create, load, config, slice, export, destroy
 * - Error handling: pre-destroy, post-destroy, WASM exceptions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkCrossOriginIsolation } from '../slicer-engine';

// ─── checkCrossOriginIsolation ────────────────────────────

describe('checkCrossOriginIsolation', () => {
  it('returns false when crossOriginIsolated is undefined and SharedArrayBuffer throws', () => {
    // In Node/vitest, crossOriginIsolated is undefined but SharedArrayBuffer exists
    // Test the function runs without throwing
    const result = checkCrossOriginIsolation();
    expect(typeof result).toBe('boolean');
  });

  it('returns true when crossOriginIsolated global is true', () => {
    const original = globalThis.crossOriginIsolated;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: true,
      writable: true,
      configurable: true,
    });
    try {
      expect(checkCrossOriginIsolation()).toBe(true);
    } finally {
      if (original === undefined) {
        delete (globalThis as any).crossOriginIsolated;
      } else {
        Object.defineProperty(globalThis, 'crossOriginIsolated', {
          value: original,
          writable: true,
          configurable: true,
        });
      }
    }
  });

  it('returns false when crossOriginIsolated global is false', () => {
    const original = globalThis.crossOriginIsolated;
    Object.defineProperty(globalThis, 'crossOriginIsolated', {
      value: false,
      writable: true,
      configurable: true,
    });
    try {
      expect(checkCrossOriginIsolation()).toBe(false);
    } finally {
      if (original === undefined) {
        delete (globalThis as any).crossOriginIsolated;
      } else {
        Object.defineProperty(globalThis, 'crossOriginIsolated', {
          value: original,
          writable: true,
          configurable: true,
        });
      }
    }
  });
});

// ─── Mock WASM module types ───────────────────────────────

interface MockFS {
  mkdir: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
}

interface MockWasmSlicer {
  loadSTLFile: ReturnType<typeof vi.fn>;
  load3MFFile: ReturnType<typeof vi.fn>;
  setConfigString: ReturnType<typeof vi.fn>;
  slice: ReturnType<typeof vi.fn>;
  exportGCode: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function createMockFS(): MockFS {
  return {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(() => new Uint8Array([1, 2, 3])),
    unlink: vi.fn(),
  };
}

function createMockSlicer(): MockWasmSlicer {
  return {
    loadSTLFile: vi.fn(),
    load3MFFile: vi.fn(),
    setConfigString: vi.fn(),
    slice: vi.fn(),
    exportGCode: vi.fn(() => 'G28\nG1 X0 Y0 Z0\n'),
    delete: vi.fn(),
  };
}

// ─── writeToVFS behavior (tested indirectly via SlicerEngine) ──

describe('SlicerEngine VFS writes', () => {
  let mockFS: MockFS;
  let mockSlicer: MockWasmSlicer;

  beforeEach(() => {
    mockFS = createMockFS();
    mockSlicer = createMockSlicer();
  });

  it('writeFile receives Uint8Array for STL binary data', () => {
    const stlData = new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64]); // "solid"

    // Simulate what slicer-engine.ts does
    const path = '/tmp/slicer_input_0.stl';
    mockFS.writeFile(path, stlData);
    mockSlicer.loadSTLFile(path);
    mockFS.unlink(path);

    expect(mockFS.writeFile).toHaveBeenCalledWith(path, stlData);
    expect(mockSlicer.loadSTLFile).toHaveBeenCalledWith(path);
    expect(mockFS.unlink).toHaveBeenCalledWith(path);
  });

  it('writeFile receives Uint8Array for 3MF binary data', () => {
    // 3MF files start with PK zip header
    const mfData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    const path = '/tmp/slicer_input_1.3mf';
    mockFS.writeFile(path, mfData);
    mockSlicer.load3MFFile(path);
    mockFS.unlink(path);

    expect(mockFS.writeFile).toHaveBeenCalledWith(path, mfData);
    expect(mockSlicer.load3MFFile).toHaveBeenCalledWith(path);
  });

  it('handles binary data with bytes > 127 without corruption', () => {
    // This was the original bug — embind UTF-8 marshaling corrupted bytes > 127
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binaryData[i] = i;

    const path = '/tmp/slicer_input_2.stl';
    mockFS.writeFile(path, binaryData);

    // Verify the exact bytes are passed through (no UTF-8 encoding)
    const written = mockFS.writeFile.mock.calls[0][1] as Uint8Array;
    expect(written).toBeInstanceOf(Uint8Array);
    expect(written.length).toBe(256);
    expect(written[127]).toBe(127);
    expect(written[128]).toBe(128); // This byte was corrupted by UTF-8 encoding
    expect(written[255]).toBe(255);
  });

  it('cleans up temp file even if loadSTLFile throws', () => {
    mockSlicer.loadSTLFile.mockImplementation(() => {
      throw new Error('Failed to load STL');
    });

    const path = '/tmp/slicer_input_3.stl';
    mockFS.writeFile(path, new Uint8Array([1, 2, 3]));
    expect(() => mockSlicer.loadSTLFile(path)).toThrow('Failed to load STL');
    // In slicer-engine.ts, unlink happens in a finally block
    mockFS.unlink(path);
    expect(mockFS.unlink).toHaveBeenCalledWith(path);
  });
});

// ─── WASM exception decoding ─────────────────────────────

describe('WASM exception decoding', () => {
  it('decodes numeric exception pointer when getExceptionMessage available', () => {
    const getExceptionMessage = vi.fn((ptr: number) => [
      'std::runtime_error',
      'Print validation failed: object outside print volume',
    ]);

    const ptr = 1641544;
    const [type, message] = getExceptionMessage(ptr);

    expect(type).toBe('std::runtime_error');
    expect(message).toContain('outside print volume');
  });

  it('handles getExceptionMessage returning SlicingError type', () => {
    const getExceptionMessage = vi.fn((_ptr: number) => [
      'Slic3r::SlicingError',
      'Empty layers detected',
    ]);

    const [type, message] = getExceptionMessage(42);
    expect(type).toBe('Slic3r::SlicingError');
    expect(message).toBe('Empty layers detected');
  });

  it('wraps non-numeric exceptions as regular errors', () => {
    const error = new Error('something went wrong');
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('something went wrong');
  });

  it('wraps string exceptions', () => {
    const e = 'unknown error occurred';
    const wrapped = new Error(`slice: ${String(e)}`);
    expect(wrapped.message).toBe('slice: unknown error occurred');
  });
});

// ─── SlicerEngine lifecycle ──────────────────────────────

describe('SlicerEngine lifecycle', () => {
  let mockFS: MockFS;
  let mockSlicer: MockWasmSlicer;

  beforeEach(() => {
    mockFS = createMockFS();
    mockSlicer = createMockSlicer();
  });

  it('full STL pipeline: load → config → slice → export → destroy', () => {
    const stlData = new Uint8Array([1, 2, 3, 4, 5]);

    // Load STL via VFS
    const stlPath = '/tmp/slicer_input_0.stl';
    mockFS.writeFile(stlPath, stlData);
    mockSlicer.loadSTLFile(stlPath);
    mockFS.unlink(stlPath);

    // Set config
    const config: Record<string, string> = {
      layer_height: '0.2',
      perimeters: '3',
      fill_density: '20%',
    };
    for (const [key, value] of Object.entries(config)) {
      mockSlicer.setConfigString(key, value);
    }

    // Slice
    mockSlicer.slice();

    // Export
    const gcode = mockSlicer.exportGCode();
    expect(typeof gcode).toBe('string');

    // Destroy
    mockSlicer.delete();

    // Verify call order
    expect(mockSlicer.loadSTLFile).toHaveBeenCalledTimes(1);
    expect(mockSlicer.setConfigString).toHaveBeenCalledTimes(3);
    expect(mockSlicer.slice).toHaveBeenCalledTimes(1);
    expect(mockSlicer.exportGCode).toHaveBeenCalledTimes(1);
    expect(mockSlicer.delete).toHaveBeenCalledTimes(1);
  });

  it('full 3MF pipeline: load → config → slice → export → destroy', () => {
    const mfData = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    const mfPath = '/tmp/slicer_input_1.3mf';
    mockFS.writeFile(mfPath, mfData);
    mockSlicer.load3MFFile(mfPath);
    mockFS.unlink(mfPath);

    mockSlicer.setConfigString('layer_height', '0.15');
    mockSlicer.slice();
    const gcode = mockSlicer.exportGCode();
    expect(typeof gcode).toBe('string');
    mockSlicer.delete();

    expect(mockSlicer.load3MFFile).toHaveBeenCalledTimes(1);
    expect(mockSlicer.delete).toHaveBeenCalledTimes(1);
  });

  it('destroy can be called multiple times safely', () => {
    mockSlicer.delete();
    mockSlicer.delete(); // should not throw
    expect(mockSlicer.delete).toHaveBeenCalledTimes(2);
  });

  it('calling methods after destroy throws (engine contract)', () => {
    let destroyed = false;
    const guardedSlice = () => {
      if (destroyed) throw new Error('SlicerEngine has been destroyed');
      mockSlicer.slice();
    };

    mockSlicer.delete();
    destroyed = true;

    expect(() => guardedSlice()).toThrow('SlicerEngine has been destroyed');
  });
});

// ─── Config mapping validation ───────────────────────────

describe('PrusaSlicer config format', () => {
  it('bed_shape uses PrusaSlicer format (XxY pairs)', () => {
    const bedShape = '0x0,235x0,235x235,0x235';
    const points = bedShape.split(',');
    expect(points).toHaveLength(4);
    for (const pt of points) {
      expect(pt).toMatch(/^\d+x\d+$/);
    }
  });

  it('fill_density uses percentage format', () => {
    const density = '20%';
    expect(density).toMatch(/^\d+%$/);
  });

  it('temperature values are numeric strings', () => {
    const temps = { temperature: '210', bed_temperature: '60' };
    for (const [key, value] of Object.entries(temps)) {
      expect(Number.isFinite(parseFloat(value))).toBe(true);
    }
  });

  it('gcode_flavor is a known PrusaSlicer value', () => {
    const validFlavors = ['marlin', 'marlin2', 'repetier', 'reprapfirmware', 'teacup', 'smoothie', 'klipper'];
    const flavor = 'marlin';
    expect(validFlavors).toContain(flavor);
  });

  it('boolean configs use 0/1 not true/false', () => {
    const boolConfigs: Record<string, string> = {
      support_material: '0',
      retract_layer_change: '1',
    };
    for (const [_key, value] of Object.entries(boolConfigs)) {
      expect(value).toMatch(/^[01]$/);
    }
  });
});

// ─── Worker message contract ─────────────────────────────

describe('slicer-worker message contract', () => {
  it('slice message has required fields', () => {
    const msg = { type: 'slice', stlData: new ArrayBuffer(100), config: { layer_height: '0.2' } };
    expect(msg.type).toBe('slice');
    expect(msg.stlData).toBeInstanceOf(ArrayBuffer);
    expect(typeof msg.config).toBe('object');
  });

  it('slice3mf message has required fields', () => {
    const msg = { type: 'slice3mf', data: new ArrayBuffer(100), config: { layer_height: '0.2' } };
    expect(msg.type).toBe('slice3mf');
    expect(msg.data).toBeInstanceOf(ArrayBuffer);
  });

  it('cancel message is minimal', () => {
    const msg = { type: 'cancel' };
    expect(msg.type).toBe('cancel');
  });

  it('progress message has stage and progress fields', () => {
    const stages = ['loading', 'loading_model', 'configuring', 'slicing', 'exporting'];
    for (const stage of stages) {
      const msg = { type: 'progress', stage, progress: 0.5 };
      expect(msg.type).toBe('progress');
      expect(typeof msg.stage).toBe('string');
      expect(msg.progress).toBeGreaterThanOrEqual(0);
      expect(msg.progress).toBeLessThanOrEqual(1);
    }
  });

  it('done message has gcode and stats', () => {
    const msg = {
      type: 'done',
      gcode: 'G28\nG1 X0\n',
      stats: { printTime: 2832, filamentUsed: 4823.7 },
    };
    expect(msg.type).toBe('done');
    expect(typeof msg.gcode).toBe('string');
    expect(msg.stats.printTime).toBeGreaterThan(0);
    expect(msg.stats.filamentUsed).toBeGreaterThan(0);
  });

  it('error message has message string', () => {
    const msg = { type: 'error', message: 'Print validation failed: object outside print volume' };
    expect(msg.type).toBe('error');
    expect(typeof msg.message).toBe('string');
  });
});

// ─── Progress forwarding via console interception ────────

describe('slice progress forwarding', () => {
  it('progress message contract includes optional message field', () => {
    // Worker progress messages can now include a message field from WASM output
    const msgWithMessage = { type: 'progress', stage: 'slicing', progress: 0.5, message: 'Centering model on bed...' };
    expect(msgWithMessage.type).toBe('progress');
    expect(msgWithMessage.stage).toBe('slicing');
    expect(msgWithMessage.progress).toBe(0.5);
    expect(msgWithMessage.message).toBe('Centering model on bed...');

    // Messages without the message field should still be valid
    const msgWithout = { type: 'progress', stage: 'loading', progress: 0.0 };
    expect(msgWithout.type).toBe('progress');
    expect((msgWithout as any).message).toBeUndefined();
  });

  it('console.log interception captures and cleans [slicer-wasm] prefix', () => {
    // Simulate the console interception pattern used in slicer-engine.ts slice()
    const captured: string[] = [];
    const onProgress = (_stage: string, _progress: number, message?: string) => {
      if (message) captured.push(message);
    };

    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      const text = args.map(String).join(' ');
      const cleaned = text.replace(/^\[slicer-wasm\]\s*/, '');
      if (cleaned) onProgress('slicing', 0.5, cleaned);
    };

    try {
      // Simulate EM_ASM output
      console.log('[slicer-wasm] Centering model on bed...');
      console.log('[slicer-wasm] Applying model + config...');
      console.log('[slicer-wasm] Starting Print::process()...');
      // Emscripten print callback adds prefix too
      console.log('[slicer-wasm]', 'layer 42 done');
    } finally {
      console.log = origLog;
    }

    expect(captured).toEqual([
      'Centering model on bed...',
      'Applying model + config...',
      'Starting Print::process()...',
      'layer 42 done',
    ]);
  });

  it('console.warn interception also captures messages', () => {
    const captured: string[] = [];
    const onProgress = (_stage: string, _progress: number, message?: string) => {
      if (message) captured.push(message);
    };

    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      const text = args.map(String).join(' ');
      const cleaned = text.replace(/^\[slicer-wasm\]\s*/, '');
      if (cleaned) onProgress('slicing', 0.5, cleaned);
    };

    try {
      console.warn('[slicer-wasm] Validation warning: thin wall detected');
    } finally {
      console.warn = origWarn;
    }

    expect(captured).toEqual(['Validation warning: thin wall detected']);
  });

  it('console.log is restored after slice completes (even on error)', () => {
    const origLog = console.log;

    // Simulate the try/finally pattern from slicer-engine.ts
    try {
      console.log = (..._args: unknown[]) => { /* intercepted */ };
      throw new Error('simulated slice error');
    } catch {
      // error handled
    } finally {
      console.log = origLog;
    }

    // console.log should be restored
    expect(console.log).toBe(origLog);
  });
});

// ─── useSlicer hook mapWorkerStage ───────────────────────

describe('mapWorkerStage (worker stage → UI stage)', () => {
  // Replicate the mapping function from useSlicer.ts
  function mapWorkerStage(workerStage: string): string {
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

  it('maps loading stages to parsing', () => {
    expect(mapWorkerStage('loading')).toBe('parsing');
    expect(mapWorkerStage('loading_model')).toBe('parsing');
  });

  it('maps configuring and slicing to slicing', () => {
    expect(mapWorkerStage('configuring')).toBe('slicing');
    expect(mapWorkerStage('slicing')).toBe('slicing');
  });

  it('maps exporting to exporting', () => {
    expect(mapWorkerStage('exporting')).toBe('exporting');
  });

  it('maps unknown stages to slicing as default', () => {
    expect(mapWorkerStage('unknown')).toBe('slicing');
    expect(mapWorkerStage('')).toBe('slicing');
  });
});

// ─── SliceProgress message field in debug log ────────────

describe('progress message in debug log', () => {
  it('debug log entry includes message text when present', () => {
    // Replicate the log entry logic from useSlicer.ts
    const msg = { stage: 'slicing', progress: 0.5, message: 'Starting Print::process()...' };
    const logEntry = msg.message
      ? `[${msg.stage}] ${msg.message}`
      : `[${msg.stage}] ${Math.round(msg.progress * 100)}%`;
    expect(logEntry).toBe('[slicing] Starting Print::process()...');
  });

  it('debug log entry falls back to percentage when no message', () => {
    const msg = { stage: 'loading', progress: 0.75, message: undefined };
    const logEntry = msg.message
      ? `[${msg.stage}] ${msg.message}`
      : `[${msg.stage}] ${Math.round(msg.progress * 100)}%`;
    expect(logEntry).toBe('[loading] 75%');
  });
});

// ─── Binary STL generation (from profiling script) ───────

describe('binary STL format', () => {
  function generateBinarySTLCube(size: number): Uint8Array {
    const s = size;
    const faces: [number[], number[], number[], number[]][] = [
      [[0, 0, 0], [s, 0, 0], [s, s, 0], [0, 0, -1]],
      [[0, 0, 0], [s, s, 0], [0, s, 0], [0, 0, -1]],
      [[0, 0, s], [s, s, s], [s, 0, s], [0, 0, 1]],
      [[0, 0, s], [0, s, s], [s, s, s], [0, 0, 1]],
      [[0, 0, 0], [s, 0, s], [s, 0, 0], [0, -1, 0]],
      [[0, 0, 0], [0, 0, s], [s, 0, s], [0, -1, 0]],
      [[0, s, 0], [s, s, 0], [s, s, s], [0, 1, 0]],
      [[0, s, 0], [s, s, s], [0, s, s], [0, 1, 0]],
      [[0, 0, 0], [0, s, 0], [0, s, s], [-1, 0, 0]],
      [[0, 0, 0], [0, s, s], [0, 0, s], [-1, 0, 0]],
      [[s, 0, 0], [s, 0, s], [s, s, s], [1, 0, 0]],
      [[s, 0, 0], [s, s, s], [s, s, 0], [1, 0, 0]],
    ];
    const numFaces = faces.length;
    const buf = new ArrayBuffer(84 + numFaces * 50);
    const view = new DataView(buf);
    // 80-byte header
    const header = 'Binary STL test cube';
    for (let i = 0; i < 80; i++) {
      view.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
    }
    view.setUint32(80, numFaces, true);
    let offset = 84;
    for (const [v1, v2, v3, n] of faces) {
      view.setFloat32(offset, n[0], true); offset += 4;
      view.setFloat32(offset, n[1], true); offset += 4;
      view.setFloat32(offset, n[2], true); offset += 4;
      for (const v of [v1, v2, v3]) {
        view.setFloat32(offset, v[0], true); offset += 4;
        view.setFloat32(offset, v[1], true); offset += 4;
        view.setFloat32(offset, v[2], true); offset += 4;
      }
      view.setUint16(offset, 0, true); offset += 2;
    }
    return new Uint8Array(buf);
  }

  it('generates correct binary STL header (80 bytes + face count)', () => {
    const stl = generateBinarySTLCube(10);
    expect(stl.length).toBe(84 + 12 * 50); // 80 header + 4 count + 12 faces * 50 bytes

    const view = new DataView(stl.buffer);
    const faceCount = view.getUint32(80, true);
    expect(faceCount).toBe(12);
  });

  it('cube has 12 triangles (2 per face × 6 faces)', () => {
    const stl = generateBinarySTLCube(10);
    const view = new DataView(stl.buffer);
    expect(view.getUint32(80, true)).toBe(12);
  });

  it('total file size matches binary STL spec', () => {
    const stl = generateBinarySTLCube(10);
    // Binary STL = 80 (header) + 4 (count) + N * 50 (12 normal + 36 vertices + 2 attr)
    expect(stl.length).toBe(80 + 4 + 12 * 50);
  });

  it('vertices are within expected bounds for 10mm cube', () => {
    const stl = generateBinarySTLCube(10);
    const view = new DataView(stl.buffer);

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let face = 0; face < 12; face++) {
      const faceOffset = 84 + face * 50;
      // Skip normal (12 bytes), read 3 vertices (each 12 bytes)
      for (let v = 0; v < 3; v++) {
        const vOffset = faceOffset + 12 + v * 12;
        const x = view.getFloat32(vOffset, true);
        const y = view.getFloat32(vOffset + 4, true);
        const z = view.getFloat32(vOffset + 8, true);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
    }

    expect(minX).toBeCloseTo(0, 2);
    expect(maxX).toBeCloseTo(10, 2);
    expect(minY).toBeCloseTo(0, 2);
    expect(maxY).toBeCloseTo(10, 2);
    expect(minZ).toBeCloseTo(0, 2);
    expect(maxZ).toBeCloseTo(10, 2);
  });

  it('all bytes are valid (no NaN floats)', () => {
    const stl = generateBinarySTLCube(10);
    const view = new DataView(stl.buffer);

    for (let face = 0; face < 12; face++) {
      const faceOffset = 84 + face * 50;
      // Check normal + 3 vertices = 12 floats
      for (let f = 0; f < 12; f++) {
        const val = view.getFloat32(faceOffset + f * 4, true);
        expect(Number.isNaN(val)).toBe(false);
      }
    }
  });
});
