// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import {
  merge3mf,
  extractColorMeshes,
  type ColoredModel,
} from '../merge-3mf';

/**
 * Create a binary STL with N triangles from flat vertex data.
 * verts: [x1,y1,z1, x2,y2,z2, x3,y3,z3, ...] — 9 floats per triangle
 */
function makeSTL(verts: number[]): Uint8Array {
  const triCount = verts.length / 9;
  const buf = new ArrayBuffer(80 + 4 + triCount * 50);
  const view = new DataView(buf);
  view.setUint32(80, triCount, true);
  for (let t = 0; t < triCount; t++) {
    const base = 84 + t * 50;
    // Normal (0,0,0)
    // 3 vertices
    for (let v = 0; v < 3; v++) {
      const vi = t * 9 + v * 3;
      view.setFloat32(base + 12 + v * 12, verts[vi], true);
      view.setFloat32(base + 12 + v * 12 + 4, verts[vi + 1], true);
      view.setFloat32(base + 12 + v * 12 + 8, verts[vi + 2], true);
    }
  }
  return new Uint8Array(buf);
}

/**
 * Make a cube from (0,0,0) to (s,s,s) as 12 triangles.
 */
function makeCubeVerts(s: number, ox = 0, oy = 0, oz = 0): number[] {
  const x0 = ox, y0 = oy, z0 = oz;
  const x1 = ox + s, y1 = oy + s, z1 = oz + s;
  return [
    // +Z
    x0,y0,z1, x1,y0,z1, x1,y1,z1,
    x0,y0,z1, x1,y1,z1, x0,y1,z1,
    // -Z
    x0,y0,z0, x0,y1,z0, x1,y1,z0,
    x0,y0,z0, x1,y1,z0, x1,y0,z0,
    // +X
    x1,y0,z0, x1,y1,z0, x1,y1,z1,
    x1,y0,z0, x1,y1,z1, x1,y0,z1,
    // -X
    x0,y0,z0, x0,y0,z1, x0,y1,z1,
    x0,y0,z0, x0,y1,z1, x0,y1,z0,
    // +Y
    x0,y1,z0, x0,y1,z1, x1,y1,z1,
    x0,y1,z0, x1,y1,z1, x1,y1,z0,
    // -Y
    x0,y0,z0, x1,y0,z0, x1,y0,z1,
    x0,y0,z0, x1,y0,z1, x0,y0,z1,
  ];
}

describe('merge-3mf round-trip', () => {
  it('extractColorMeshes recovers vertices from merge3mf output', () => {
    // Two cubes at different positions, different colors
    const cube1Verts = makeCubeVerts(10, 0, 0, 0);
    const cube2Verts = makeCubeVerts(5, 20, 0, 0);

    const inputs: ColoredModel[] = [
      { color: [0, 0, 0, 1], data: makeSTL(cube1Verts) },
      { color: [1, 1, 1, 1], data: makeSTL(cube2Verts) },
    ];

    const merged3mf = merge3mf(inputs);
    const meshes = extractColorMeshes(merged3mf.buffer);

    expect(meshes).toHaveLength(2);

    // Check mesh 0 (black cube — extruder 0)
    const m0 = meshes[0];
    expect(m0.extruder).toBe(0);
    expect(m0.vertices.length).toBe(cube1Verts.length); // 12 tris × 9 floats

    // Check mesh 1 (white cube — extruder 1)
    const m1 = meshes[1];
    expect(m1.extruder).toBe(1);
    expect(m1.vertices.length).toBe(cube2Verts.length);

    // Verify actual vertex values round-trip correctly.
    // merge3mf deduplicates vertices, but extractColorMeshes expands triangle
    // indices back to flat vertex data. Values should be close (float precision).
    for (let i = 0; i < cube1Verts.length; i++) {
      expect(m0.vertices[i]).toBeCloseTo(cube1Verts[i], 4);
    }
    for (let i = 0; i < cube2Verts.length; i++) {
      expect(m1.vertices[i]).toBeCloseTo(cube2Verts[i], 4);
    }
  });

  it('preserves many small cubes (QR-like pattern)', () => {
    // Simulate QR code: a grid of small cubes where some are present and some aren't
    // 5x5 grid, 1.4mm modules, 0.2mm gap between (none for QR)
    const moduleSize = 1.4;
    const pattern = [
      [1, 1, 1, 0, 1],
      [1, 0, 1, 0, 0],
      [1, 1, 1, 1, 0],
      [0, 0, 1, 0, 1],
      [1, 0, 0, 1, 1],
    ];

    // Build "dark modules" (white in our model)
    const darkVerts: number[] = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        if (pattern[row][col]) {
          darkVerts.push(...makeCubeVerts(moduleSize, col * moduleSize, row * moduleSize, 0));
        }
      }
    }

    // Build "body" — a large base with module-shaped holes
    // For simplicity, just the large base plate
    const bodyVerts = makeCubeVerts(5 * moduleSize, 0, 0, -2);

    const inputs: ColoredModel[] = [
      { color: [0, 0, 0, 1], data: makeSTL(bodyVerts) },
      { color: [1, 1, 1, 1], data: makeSTL(darkVerts) },
    ];

    const merged = merge3mf(inputs);
    const meshes = extractColorMeshes(merged.buffer);

    expect(meshes).toHaveLength(2);

    // Count dark modules: sum of 1s in pattern
    const darkCount = pattern.flat().filter(v => v === 1).length;
    const expectedDarkTris = darkCount * 12; // 12 tris per cube
    const expectedDarkVerts = expectedDarkTris * 9; // 9 floats per tri

    expect(meshes[1].extruder).toBe(1);
    expect(meshes[1].vertices.length).toBe(expectedDarkVerts);

    // Verify a specific module position round-trips correctly.
    // Module at (0,0) should have vertices starting at (0,0,0).
    // Since triangles are in order, the first triangle of the first module
    // should be the +Z face starting at (0,0,moduleSize).
    const whiteVerts = meshes[1].vertices;
    // Find any vertex near (0, 0, moduleSize) — the first module's top face
    let found = false;
    for (let i = 0; i < whiteVerts.length; i += 3) {
      if (Math.abs(whiteVerts[i]) < 0.01 &&
          Math.abs(whiteVerts[i+1]) < 0.01 &&
          Math.abs(whiteVerts[i+2] - moduleSize) < 0.01) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('vertex data matches between input STL and extracted mesh', () => {
    // Create a non-trivial shape: two triangles at specific coordinates
    const verts = [
      1.23, 4.56, 7.89,   2.34, 5.67, 8.90,   3.45, 6.78, 9.01,
      10.1, 20.2, 30.3,   40.4, 50.5, 60.6,   70.7, 80.8, 90.9,
    ];

    const inputs: ColoredModel[] = [
      { color: [1, 0, 0, 1], data: makeSTL(verts) },
      { color: [0, 1, 0, 1], data: makeSTL([0,0,0, 1,0,0, 0,1,0]) },
    ];

    const merged = merge3mf(inputs);
    const meshes = extractColorMeshes(merged.buffer);

    expect(meshes).toHaveLength(2);

    // Red mesh vertices should exactly match input
    const extracted = meshes[0].vertices;
    expect(extracted.length).toBe(verts.length);

    // Check that vertex values survive the merge3mf → extractColorMeshes round-trip
    // The merge3mf function deduplicates vertices, then extractColorMeshes expands
    // triangle indices back. The values should be exact (or very close).
    for (let i = 0; i < verts.length; i++) {
      expect(extracted[i]).toBeCloseTo(verts[i], 3);
    }
  });
});
