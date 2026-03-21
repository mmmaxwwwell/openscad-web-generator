// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { convertKlipperGcode, getModelHeightFromSTL } from '../slicer-settings';

// ─── convertKlipperGcode ──────────────────────────────────

describe('convertKlipperGcode', () => {
  it('converts Klipper {tool} to PrusaSlicer [next_extruder]', () => {
    expect(convertKlipperGcode('T{tool}')).toBe('T[next_extruder]');
  });

  it('converts uppercase {TOOL}', () => {
    expect(convertKlipperGcode('T{TOOL}')).toBe('T[next_extruder]');
  });

  it('converts {tool_nr}', () => {
    expect(convertKlipperGcode('T{tool_nr}')).toBe('T[next_extruder]');
  });

  it('converts Klipper temperature variables', () => {
    expect(convertKlipperGcode('M104 S{temp}')).toBe('M104 S[first_layer_temperature]');
    expect(convertKlipperGcode('M140 S{BED_TEMP}')).toBe('M140 S[first_layer_bed_temperature]');
  });

  it('passes PrusaSlicer-native expressions through unchanged', () => {
    // PrusaSlicer expressions like {next_extruder} and {first_layer_temperature[0]}
    expect(convertKlipperGcode('T{next_extruder}')).toBe('T{next_extruder}');
    expect(convertKlipperGcode('M109 S{first_layer_temperature[0]}')).toBe('M109 S{first_layer_temperature[0]}');
  });

  it('handles multiple variables in one string', () => {
    const input = 'START_PRINT BED_TEMP={BED_TEMP} EXTRUDER_TEMP={EXTRUDER_TEMP}';
    const expected = 'START_PRINT BED_TEMP=[first_layer_bed_temperature] EXTRUDER_TEMP=[first_layer_temperature]';
    expect(convertKlipperGcode(input)).toBe(expected);
  });
});

// ─── getModelHeightFromSTL ────────────────────────────────

describe('getModelHeightFromSTL', () => {
  function makeBinarySTL(triangles: { vertices: [number, number, number][] }[]): ArrayBuffer {
    const numTriangles = triangles.length;
    const buf = new ArrayBuffer(84 + numTriangles * 50);
    const view = new DataView(buf);
    view.setUint32(80, numTriangles, true);
    for (let i = 0; i < numTriangles; i++) {
      const base = 84 + i * 50;
      for (let v = 0; v < 3; v++) {
        const verts = triangles[i].vertices[v];
        view.setFloat32(base + 12 + v * 12, verts[0], true);
        view.setFloat32(base + 12 + v * 12 + 4, verts[1], true);
        view.setFloat32(base + 12 + v * 12 + 8, verts[2], true);
      }
    }
    return buf;
  }

  it('returns max Z from triangles', () => {
    const stl = makeBinarySTL([
      { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 5]] },
      { vertices: [[0, 0, 0], [1, 0, 10], [0, 1, 3]] },
    ]);
    expect(getModelHeightFromSTL(stl)).toBe(10);
  });

  it('returns 0 for too-small buffer', () => {
    expect(getModelHeightFromSTL(new ArrayBuffer(10))).toBe(0);
  });

  it('returns 0 for truncated buffer', () => {
    const buf = new ArrayBuffer(84);
    const view = new DataView(buf);
    view.setUint32(80, 100, true);
    expect(getModelHeightFromSTL(buf)).toBe(0);
  });
});
