// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, beforeEach } from 'vitest';
import { generateId, generateName, cloneObject } from '../../hooks/useBuildPlate';
import type { BuildPlateObject } from '../../types/build-plate';

// ── Test helpers ─────────────────────────────────────────────────────

function makeObject(overrides?: Partial<BuildPlateObject>): BuildPlateObject {
  return {
    id: 'test-id',
    name: 'Test Object',
    type: 'stl',
    meshData: new ArrayBuffer(100),
    meshFormat: 'stl',
    position: { x: 50, y: 60 },
    rotation: 45,
    scale: { x: 1, y: 1, z: 1 },
    copies: 1,
    ...overrides,
  };
}

function makeSTLObject(name = 'Cube'): BuildPlateObject {
  return makeObject({ name, type: 'stl', meshFormat: 'stl' });
}

function make3MFObject(name = 'MultiColor'): BuildPlateObject {
  return makeObject({
    name,
    type: '3mf',
    meshFormat: '3mf',
    colorGroups: [
      { color: '#FF0000', name: 'Red' },
      { color: '#00FF00', name: 'Green' },
    ],
  });
}

function makeScadObject(name = 'Parametric'): BuildPlateObject {
  return makeObject({
    name,
    type: 'scad',
    meshFormat: 'stl',
    scadFileId: 'file-123',
    scadSource: 'cube([10,10,10]);',
    scadParams: { size: 10, label: 'test' },
    scadParamDefs: [
      { name: 'size', type: 'number', initial: 10 },
      { name: 'label', type: 'string', initial: 'test' },
    ],
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('BuildPlateObject creation', () => {
  describe('STL objects', () => {
    it('has correct type and meshFormat', () => {
      const obj = makeSTLObject();
      expect(obj.type).toBe('stl');
      expect(obj.meshFormat).toBe('stl');
    });

    it('has no SCAD source fields', () => {
      const obj = makeSTLObject();
      expect(obj.scadFileId).toBeUndefined();
      expect(obj.scadSource).toBeUndefined();
      expect(obj.scadParams).toBeUndefined();
      expect(obj.scadParamDefs).toBeUndefined();
    });

    it('has no colorGroups by default', () => {
      const obj = makeSTLObject();
      expect(obj.colorGroups).toBeUndefined();
    });
  });

  describe('3MF objects', () => {
    it('has correct type and meshFormat', () => {
      const obj = make3MFObject();
      expect(obj.type).toBe('3mf');
      expect(obj.meshFormat).toBe('3mf');
    });

    it('preserves colorGroups', () => {
      const obj = make3MFObject();
      expect(obj.colorGroups).toHaveLength(2);
      expect(obj.colorGroups![0]).toEqual({ color: '#FF0000', name: 'Red' });
      expect(obj.colorGroups![1]).toEqual({ color: '#00FF00', name: 'Green' });
    });

    it('has no SCAD source fields', () => {
      const obj = make3MFObject();
      expect(obj.scadFileId).toBeUndefined();
      expect(obj.scadSource).toBeUndefined();
    });
  });

  describe('SCAD objects', () => {
    it('has scad type with stl meshFormat (rendered output)', () => {
      const obj = makeScadObject();
      expect(obj.type).toBe('scad');
      expect(obj.meshFormat).toBe('stl');
    });

    it('stores SCAD source and params', () => {
      const obj = makeScadObject();
      expect(obj.scadFileId).toBe('file-123');
      expect(obj.scadSource).toBe('cube([10,10,10]);');
      expect(obj.scadParams).toEqual({ size: 10, label: 'test' });
    });

    it('stores parameter definitions for the editor', () => {
      const obj = makeScadObject();
      expect(obj.scadParamDefs).toHaveLength(2);
      expect(obj.scadParamDefs![0].name).toBe('size');
      expect(obj.scadParamDefs![1].type).toBe('string');
    });

    it('can have 3mf meshFormat for multicolor SCAD renders', () => {
      const obj = makeObject({
        type: 'scad',
        meshFormat: '3mf',
        colorGroups: [{ color: '#FF0000' }],
        scadSource: 'color("red") cube(10);',
      });
      expect(obj.type).toBe('scad');
      expect(obj.meshFormat).toBe('3mf');
      expect(obj.colorGroups).toHaveLength(1);
    });
  });

  describe('default transform values', () => {
    it('starts at origin with no rotation and unit scale', () => {
      const obj = makeObject({
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
      });
      expect(obj.position).toEqual({ x: 0, y: 0 });
      expect(obj.rotation).toBe(0);
      expect(obj.scale).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('defaults copies to 1', () => {
      const obj = makeObject();
      expect(obj.copies).toBe(1);
    });

    it('defaults printOverrides to undefined', () => {
      const obj = makeObject();
      expect(obj.printOverrides).toBeUndefined();
    });

    it('defaults extruderAssignment to undefined', () => {
      const obj = makeObject();
      expect(obj.extruderAssignment).toBeUndefined();
    });
  });
});

describe('generateId', () => {
  it('returns a string', () => {
    const id = generateId();
    expect(typeof id).toBe('string');
  });

  it('returns unique IDs on consecutive calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
  });

  it('starts with "obj-" prefix', () => {
    const id = generateId();
    expect(id.startsWith('obj-')).toBe(true);
  });

  it('contains a timestamp component', () => {
    const before = Date.now();
    const id = generateId();
    const after = Date.now();
    // Format: obj-{timestamp}-{counter}
    const parts = id.split('-');
    const timestamp = parseInt(parts[1], 10);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('generateName', () => {
  it('returns "Object 1" for empty object list', () => {
    expect(generateName([])).toBe('Object 1');
  });

  it('auto-increments from existing objects', () => {
    const objects = [
      makeObject({ name: 'Object 1' }),
      makeObject({ name: 'Object 2' }),
    ];
    expect(generateName(objects)).toBe('Object 3');
  });

  it('returns baseName when provided', () => {
    const objects = [makeObject({ name: 'Object 1' })];
    expect(generateName(objects, 'My Custom Name')).toBe('My Custom Name');
  });

  it('returns baseName even when empty string', () => {
    // Empty string is truthy for baseName — will return empty
    // Actually empty string is falsy, so it falls through
    expect(generateName([], '')).toBe('Object 1');
  });

  it('ignores non-numbered objects when counting', () => {
    const objects = [
      makeObject({ name: 'Cube' }),
      makeObject({ name: 'Object 3' }),
      makeObject({ name: 'My Thing' }),
    ];
    expect(generateName(objects)).toBe('Object 4');
  });

  it('handles gaps in numbering', () => {
    const objects = [
      makeObject({ name: 'Object 1' }),
      makeObject({ name: 'Object 5' }),
    ];
    // Uses max number + 1, not gap filling
    expect(generateName(objects)).toBe('Object 6');
  });

  it('handles objects named "Object 0"', () => {
    const objects = [makeObject({ name: 'Object 0' })];
    // "Object 0" doesn't match /^Object \d+$/ — wait it does, \d matches 0
    // max(0, 0) = 0, so result is Object 1
    expect(generateName(objects)).toBe('Object 1');
  });

  it('handles large numbers', () => {
    const objects = [makeObject({ name: 'Object 999' })];
    expect(generateName(objects)).toBe('Object 1000');
  });
});

describe('cloneObject', () => {
  let original: BuildPlateObject;

  beforeEach(() => {
    original = makeObject({
      id: 'orig-1',
      name: 'Original',
      position: { x: 100, y: 200 },
      rotation: 90,
      scale: { x: 2, y: 2, z: 2 },
      printOverrides: { layerHeight: 0.3, wallLoops: 5 },
      scadParams: { size: 20 },
      colorGroups: [{ color: '#FF0000' }],
    });
  });

  it('generates a new unique ID', () => {
    const clone = cloneObject(original);
    expect(clone.id).not.toBe(original.id);
    expect(clone.id.startsWith('obj-')).toBe(true);
  });

  it('appends (copy) to the name', () => {
    const clone = cloneObject(original);
    expect(clone.name).toBe('Original (copy)');
  });

  it('offsets position by default 10mm', () => {
    const clone = cloneObject(original);
    expect(clone.position).toEqual({ x: 110, y: 210 });
  });

  it('accepts custom offset', () => {
    const clone = cloneObject(original, 25);
    expect(clone.position).toEqual({ x: 125, y: 225 });
  });

  it('accepts zero offset', () => {
    const clone = cloneObject(original, 0);
    expect(clone.position).toEqual({ x: 100, y: 200 });
  });

  it('preserves rotation', () => {
    const clone = cloneObject(original);
    expect(clone.rotation).toBe(90);
  });

  it('preserves scale', () => {
    const clone = cloneObject(original);
    expect(clone.scale).toEqual({ x: 2, y: 2, z: 2 });
  });

  it('preserves type and meshFormat', () => {
    const clone = cloneObject(original);
    expect(clone.type).toBe('stl');
    expect(clone.meshFormat).toBe('stl');
  });

  it('deep-clones meshData (separate ArrayBuffer)', () => {
    const clone = cloneObject(original);
    expect(clone.meshData).not.toBe(original.meshData);
    expect(clone.meshData.byteLength).toBe(original.meshData.byteLength);
  });

  it('deep-clones printOverrides (independent copy)', () => {
    const clone = cloneObject(original);
    expect(clone.printOverrides).toEqual({ layerHeight: 0.3, wallLoops: 5 });
    expect(clone.printOverrides).not.toBe(original.printOverrides);
    // Mutating clone overrides doesn't affect original
    clone.printOverrides!.layerHeight = 0.1;
    expect(original.printOverrides!.layerHeight).toBe(0.3);
  });

  it('deep-clones scadParams (independent copy)', () => {
    const clone = cloneObject(original);
    expect(clone.scadParams).toEqual({ size: 20 });
    expect(clone.scadParams).not.toBe(original.scadParams);
    clone.scadParams!.size = 99;
    expect(original.scadParams!.size).toBe(20);
  });

  it('deep-clones colorGroups (independent copy)', () => {
    const clone = cloneObject(original);
    expect(clone.colorGroups).toEqual([{ color: '#FF0000' }]);
    expect(clone.colorGroups).not.toBe(original.colorGroups);
    clone.colorGroups!.push({ color: '#00FF00' });
    expect(original.colorGroups).toHaveLength(1);
  });

  it('handles undefined printOverrides', () => {
    original.printOverrides = undefined;
    const clone = cloneObject(original);
    expect(clone.printOverrides).toBeUndefined();
  });

  it('handles undefined scadParams', () => {
    original.scadParams = undefined;
    const clone = cloneObject(original);
    expect(clone.scadParams).toBeUndefined();
  });

  it('handles undefined colorGroups', () => {
    original.colorGroups = undefined;
    const clone = cloneObject(original);
    expect(clone.colorGroups).toBeUndefined();
  });

  it('produces clones with unique IDs across multiple calls', () => {
    const clones = [
      cloneObject(original),
      cloneObject(original),
      cloneObject(original),
    ];
    const ids = clones.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe('type detection from file extension', () => {
  // Tests the name-stripping logic used in addSTLFile / add3MFFile

  it('strips .stl extension (case insensitive)', () => {
    expect('model.stl'.replace(/\.stl$/i, '')).toBe('model');
    expect('model.STL'.replace(/\.stl$/i, '')).toBe('model');
    expect('model.Stl'.replace(/\.stl$/i, '')).toBe('model');
  });

  it('strips .3mf extension (case insensitive)', () => {
    expect('model.3mf'.replace(/\.3mf$/i, '')).toBe('model');
    expect('model.3MF'.replace(/\.3mf$/i, '')).toBe('model');
  });

  it('preserves name without matching extension', () => {
    expect('model.obj'.replace(/\.stl$/i, '')).toBe('model.obj');
    expect('model'.replace(/\.stl$/i, '')).toBe('model');
  });

  it('handles filenames with dots', () => {
    expect('my.model.v2.stl'.replace(/\.stl$/i, '')).toBe('my.model.v2');
  });

  it('handles filenames with spaces', () => {
    expect('My Model.stl'.replace(/\.stl$/i, '')).toBe('My Model');
  });
});

describe('BuildPlateObject transform values', () => {
  it('supports negative positions (center-origin beds)', () => {
    const obj = makeObject({ position: { x: -50, y: -30 } });
    expect(obj.position.x).toBe(-50);
    expect(obj.position.y).toBe(-30);
  });

  it('supports rotation beyond 360 degrees', () => {
    const obj = makeObject({ rotation: 450 });
    expect(obj.rotation).toBe(450);
  });

  it('supports negative rotation', () => {
    const obj = makeObject({ rotation: -90 });
    expect(obj.rotation).toBe(-90);
  });

  it('supports non-uniform scale', () => {
    const obj = makeObject({ scale: { x: 2, y: 0.5, z: 1.5 } });
    expect(obj.scale).toEqual({ x: 2, y: 0.5, z: 1.5 });
  });

  it('supports negative scale (mirroring)', () => {
    const obj = makeObject({ scale: { x: -1, y: 1, z: 1 } });
    expect(obj.scale.x).toBe(-1);
  });

  it('supports fractional scale', () => {
    const obj = makeObject({ scale: { x: 0.1, y: 0.1, z: 0.1 } });
    expect(obj.scale.x).toBeCloseTo(0.1);
  });
});
