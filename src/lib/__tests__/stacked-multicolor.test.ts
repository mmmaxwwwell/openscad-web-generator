// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Integration test for multi-color 3MF with stacked objects.
 *
 * Simulates the pipeline for the stacked_colors.scad example:
 *   OpenSCAD renders each color → STL per color → merge3mf → 3MF
 *   Slicer loads 3MF → GCode with tool changes → GCode parser
 *
 * Verifies:
 * 1. merge3mf preserves vertex Z positions for stacked objects
 * 2. extractColorMeshes recovers correct Z ranges per color
 * 3. extractColorGroups returns correct hex colors (including white #FFFFFF)
 * 4. GCode parser tracks T (tool change) commands for correct extruder assignment
 * 5. Extruder-to-color mapping produces the right color for each extruder index
 */

import { describe, it, expect } from 'vitest';
import {
  merge3mf,
  extractColorGroups,
  extractColorMeshes,
  type ColoredModel,
} from '../merge-3mf';
import { parseGCode } from '../gcode-parser';
import { unzipSync } from 'fflate';

// ─── Helpers ───────────────────────────────────────────────

/** Create a binary STL for an axis-aligned box with 12 triangles. */
function makeBoxSTL(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Uint8Array {
  // A box has 6 faces × 2 triangles = 12 triangles
  const triangleCount = 12;
  const buf = new ArrayBuffer(80 + 4 + triangleCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triangleCount, true);

  // 8 corners of the box
  const corners = [
    [minX, minY, minZ], // 0
    [maxX, minY, minZ], // 1
    [maxX, maxY, minZ], // 2
    [minX, maxY, minZ], // 3
    [minX, minY, maxZ], // 4
    [maxX, minY, maxZ], // 5
    [maxX, maxY, maxZ], // 6
    [minX, maxY, maxZ], // 7
  ];

  // 12 triangles (2 per face, CCW winding for outward normals)
  const faces: [number, number, number][] = [
    // Bottom (Z=min) - normal -Z
    [0, 2, 1], [0, 3, 2],
    // Top (Z=max) - normal +Z
    [4, 5, 6], [4, 6, 7],
    // Front (Y=min) - normal -Y
    [0, 1, 5], [0, 5, 4],
    // Back (Y=max) - normal +Y
    [2, 3, 7], [2, 7, 6],
    // Left (X=min) - normal -X
    [0, 4, 7], [0, 7, 3],
    // Right (X=max) - normal +X
    [1, 2, 6], [1, 6, 5],
  ];

  for (let i = 0; i < triangleCount; i++) {
    const base = 84 + i * 50;
    const [a, b, c] = faces[i];

    // Normal (0,0,0 — STL readers recompute anyway)
    view.setFloat32(base + 0, 0, true);
    view.setFloat32(base + 4, 0, true);
    view.setFloat32(base + 8, 0, true);

    // Vertex 1
    view.setFloat32(base + 12, corners[a][0], true);
    view.setFloat32(base + 16, corners[a][1], true);
    view.setFloat32(base + 20, corners[a][2], true);
    // Vertex 2
    view.setFloat32(base + 24, corners[b][0], true);
    view.setFloat32(base + 28, corners[b][1], true);
    view.setFloat32(base + 32, corners[b][2], true);
    // Vertex 3
    view.setFloat32(base + 36, corners[c][0], true);
    view.setFloat32(base + 40, corners[c][1], true);
    view.setFloat32(base + 44, corners[c][2], true);

    // Attribute byte count
    view.setUint16(base + 48, 0, true);
  }

  return new Uint8Array(buf);
}

/**
 * Get min/max Z values from a Float32Array of xyz triples.
 */
function zRange(vertices: Float32Array): { minZ: number; maxZ: number } {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 2; i < vertices.length; i += 3) {
    if (vertices[i] < minZ) minZ = vertices[i];
    if (vertices[i] > maxZ) maxZ = vertices[i];
  }
  return { minZ, maxZ };
}

// ─── Test data: stacked cubes mimicking stacked_colors.scad ───

// Red cube: 0,0,0 → 10,10,10 (on bed)
const RED_STL = makeBoxSTL(0, 0, 0, 10, 10, 10);
// White cube: 0,0,10 → 10,10,20 (stacked on top)
const WHITE_STL = makeBoxSTL(0, 0, 10, 10, 10, 20);

// Linear RGB colors (as OpenSCAD produces them)
const RED_LINEAR: [number, number, number, number] = [1, 0, 0, 1];
const WHITE_LINEAR: [number, number, number, number] = [1, 1, 1, 1];

// ─── Tests ─────────────────────────────────────────────────

describe('Stacked multi-color 3MF pipeline', () => {

  // ── Step 1: merge3mf preserves stacked geometry ──────────

  describe('merge3mf with stacked objects', () => {
    const inputs: ColoredModel[] = [
      { color: RED_LINEAR, data: RED_STL },
      { color: WHITE_LINEAR, data: WHITE_STL },
    ];
    const merged = merge3mf(inputs);

    it('produces non-empty 3MF', () => {
      expect(merged.byteLength).toBeGreaterThan(0);
    });

    it('3MF XML contains two colorgroups', () => {
      const unzipped = unzipSync(merged);
      let modelXml = '';
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.toLowerCase().endsWith('3dmodel.model')) {
          modelXml = new TextDecoder().decode(data);
        }
      }
      expect(modelXml).toBeTruthy();

      // Two colorgroup elements
      const colorGroupMatches = modelXml.match(/<colorgroup/g);
      expect(colorGroupMatches).toHaveLength(2);
    });

    it('3MF XML preserves vertex Z positions for both objects', () => {
      const unzipped = unzipSync(merged);
      let modelXml = '';
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.toLowerCase().endsWith('3dmodel.model')) {
          modelXml = new TextDecoder().decode(data);
        }
      }

      // Extract all Z values from vertex elements
      const zValues: number[] = [];
      const vertexRe = /z="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = vertexRe.exec(modelXml)) !== null) {
        zValues.push(parseFloat(m[1]));
      }

      // Must have Z=0 (bottom of red cube) and Z=20 (top of white cube)
      expect(Math.min(...zValues)).toBeCloseTo(0, 1);
      expect(Math.max(...zValues)).toBeCloseTo(20, 1);
      // Z=10 is the boundary where both cubes meet
      expect(zValues.filter(z => Math.abs(z - 10) < 0.01).length).toBeGreaterThan(0);
    });
  });

  // ── Step 2: extractColorGroups returns correct colors ────

  describe('extractColorGroups preserves white and red', () => {
    const inputs: ColoredModel[] = [
      { color: RED_LINEAR, data: RED_STL },
      { color: WHITE_LINEAR, data: WHITE_STL },
    ];
    const merged = merge3mf(inputs);
    const groups = extractColorGroups(merged.buffer as ArrayBuffer);

    it('finds 2 color groups', () => {
      expect(groups).toHaveLength(2);
    });

    it('first group is red (#FF0000)', () => {
      // linearToSRGB(1) = 1.0 → FF, linearToSRGB(0) = 0 → 00
      expect(groups[0].colorHex.substring(0, 7).toUpperCase()).toBe('#FF0000');
    });

    it('second group is white (#FFFFFF), not black or replaced', () => {
      expect(groups[1].colorHex.substring(0, 7).toUpperCase()).toBe('#FFFFFF');
    });

    it('color hex values are valid 7+ char strings', () => {
      for (const g of groups) {
        expect(g.colorHex).toMatch(/^#[0-9A-F]{6}/i);
        expect(g.colorHex.length).toBeGreaterThanOrEqual(7);
      }
    });
  });

  // ── Step 3: extractColorMeshes preserves Z positions ─────

  describe('extractColorMeshes preserves stacked positions', () => {
    const inputs: ColoredModel[] = [
      { color: RED_LINEAR, data: RED_STL },
      { color: WHITE_LINEAR, data: WHITE_STL },
    ];
    const merged = merge3mf(inputs);
    const meshes = extractColorMeshes(merged.buffer as ArrayBuffer);

    it('extracts 2 meshes', () => {
      expect(meshes).toHaveLength(2);
    });

    it('red mesh (extruder 0) has Z range 0–10', () => {
      const red = meshes[0];
      expect(red.extruder).toBe(0);
      const { minZ, maxZ } = zRange(red.vertices);
      expect(minZ).toBeCloseTo(0, 1);
      expect(maxZ).toBeCloseTo(10, 1);
    });

    it('white mesh (extruder 1) has Z range 10–20 (NOT on bed at Z=0)', () => {
      const white = meshes[1];
      expect(white.extruder).toBe(1);
      const { minZ, maxZ } = zRange(white.vertices);
      // This is the critical assertion: white must be at Z=10..20, not Z=0..10
      expect(minZ).toBeCloseTo(10, 1);
      expect(maxZ).toBeCloseTo(20, 1);
    });

    it('white mesh color is #FFFFFF, not black (#000000)', () => {
      const white = meshes[1];
      expect(white.colorHex.substring(0, 7).toUpperCase()).toBe('#FFFFFF');
      expect(white.colorHex.substring(0, 7).toUpperCase()).not.toBe('#000000');
    });

    it('red mesh color is #FF0000', () => {
      expect(meshes[0].colorHex.substring(0, 7).toUpperCase()).toBe('#FF0000');
    });
  });

  // ── Step 4: GCode parser tracks tool changes ─────────────

  describe('GCode parser multi-extruder tracking', () => {
    // Minimal multi-extruder GCode simulating PrusaSlicer output
    // for two stacked objects on a 235x235 bed
    const MULTICOLOR_GCODE = `; generated by PrusaSlicer 2.9.4
G90
M83
G28
M109 S210
M190 S60
G92 E0
;LAYER_CHANGE
;Z:0.3
;HEIGHT:0.3
T0
;TYPE:External perimeter
G1 Z0.3 F7200
G1 X110 Y110 F10800
G1 X110 Y120 E0.4 F1500
G1 X120 Y120 E0.4
G1 X120 Y110 E0.4
G1 X110 Y110 E0.4
;TYPE:Solid infill
G1 X111 Y111 F10800
G1 X119 Y111 E0.3 F1500
;LAYER_CHANGE
;Z:10.3
;HEIGHT:0.2
T1
;TYPE:External perimeter
G1 X110 Y110 Z10.3 F10800
G1 X110 Y120 E0.4 F1500
G1 X120 Y120 E0.4
G1 X120 Y110 E0.4
G1 X110 Y110 E0.4
;TYPE:Solid infill
G1 X111 Y111 F10800
G1 X119 Y111 E0.3 F1500
;LAYER_CHANGE
;Z:20.1
;HEIGHT:0.2
;TYPE:Top solid infill
G1 X111 Y111 Z20.1 F10800
G1 X119 Y111 E0.3 F750
; filament used [mm] = 1234.5
; estimated printing time (normal mode) = 0h 15m 30s
`;

    const parsed = parseGCode(MULTICOLOR_GCODE);

    it('detects 3 layers', () => {
      expect(parsed.layers).toHaveLength(3);
    });

    it('first layer (Z=0.3) segments have extruder 0', () => {
      const layer0 = parsed.layers[0];
      const extrusionSegs = layer0.segments.filter(s => s.type !== 'travel');
      expect(extrusionSegs.length).toBeGreaterThan(0);
      for (const seg of extrusionSegs) {
        expect(seg.extruder).toBe(0);
      }
    });

    it('second layer (Z=10.3) segments have extruder 1 after T1', () => {
      const layer1 = parsed.layers[1];
      const extrusionSegs = layer1.segments.filter(s => s.type !== 'travel');
      expect(extrusionSegs.length).toBeGreaterThan(0);
      for (const seg of extrusionSegs) {
        expect(seg.extruder).toBe(1);
      }
    });

    it('third layer inherits extruder 1 (no tool change)', () => {
      const layer2 = parsed.layers[2];
      const extrusionSegs = layer2.segments.filter(s => s.type !== 'travel');
      expect(extrusionSegs.length).toBeGreaterThan(0);
      for (const seg of extrusionSegs) {
        expect(seg.extruder).toBe(1);
      }
    });

    it('Z bounds span the full stacked height', () => {
      expect(parsed.bounds.minZ).toBeLessThanOrEqual(0.3);
      expect(parsed.bounds.maxZ).toBeGreaterThanOrEqual(20);
    });
  });

  // ── Step 5: Extruder-to-color mapping ────────────────────

  describe('extruder color mapping for preview', () => {
    it('colorGroups.map(cg => cg.colorHex.slice(0, 7)) produces correct extruder colors', () => {
      const inputs: ColoredModel[] = [
        { color: RED_LINEAR, data: RED_STL },
        { color: WHITE_LINEAR, data: WHITE_STL },
      ];
      const merged = merge3mf(inputs);
      const colorGroups = extractColorGroups(merged.buffer as ArrayBuffer);

      // This is what PrintDialog passes to GCodePreview as extruderColors
      const extruderColors = colorGroups.map(cg => cg.colorHex.slice(0, 7));

      expect(extruderColors).toHaveLength(2);
      expect(extruderColors[0].toUpperCase()).toBe('#FF0000'); // T0 = red
      expect(extruderColors[1].toUpperCase()).toBe('#FFFFFF'); // T1 = white, NOT black
    });
  });

  // ── Step 6: 3MF XML structure for slicer compatibility ───

  describe('3MF structure for PrusaSlicer', () => {
    const inputs: ColoredModel[] = [
      { color: RED_LINEAR, data: RED_STL },
      { color: WHITE_LINEAR, data: WHITE_STL },
    ];
    const merged = merge3mf(inputs);

    it('has components object grouping both meshes', () => {
      const unzipped = unzipSync(merged);
      let modelXml = '';
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.toLowerCase().endsWith('3dmodel.model')) {
          modelXml = new TextDecoder().decode(data);
        }
      }

      // Single object with per-triangle pid (no component group needed)
      // Triangles reference colorgroups via pid attribute
      const triPidMatches = modelXml.match(/pid="(\d+)"/g);
      expect(triPidMatches).toBeTruthy();
      // Should have pids referencing both colorgroups
      expect(modelXml).toContain('pid="1"');
      expect(modelXml).toContain('pid="2"');
    });

    it('has slicer metadata naming each part', () => {
      const unzipped = unzipSync(merged);
      let metaXml = '';
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.toLowerCase().includes('model_settings')) {
          metaXml = new TextDecoder().decode(data);
        }
      }
      expect(metaXml).toBeTruthy();
      expect(metaXml).toContain('subtype="normal_part"');
    });

    it('each color is a separate object with pid referencing its colorgroup', () => {
      const unzipped = unzipSync(merged);
      let modelXml = '';
      for (const [path, data] of Object.entries(unzipped)) {
        if (path.toLowerCase().endsWith('3dmodel.model')) {
          modelXml = new TextDecoder().decode(data);
        }
      }

      // One object per color, each with pid pointing to its colorgroup
      const objectsWithPid = modelXml.match(/<object[^>]+pid="[^"]+"/g);
      expect(objectsWithPid).toHaveLength(2); // 2 colors = 2 objects
      // Each object has its own mesh (no per-triangle pid needed)
      const meshes = modelXml.match(/<mesh>/g);
      expect(meshes).toHaveLength(2);
    });
  });
});
