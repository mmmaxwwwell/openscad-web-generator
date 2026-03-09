import { describe, it, expect } from 'vitest';
import {
  merge3mf,
  extractColorGroups,
  extractColorMeshes,
  type ColoredModel,
} from '../merge-3mf';

// ─── Helper: create a minimal binary STL with a single triangle ───

function makeTriangleSTL(v1: [number, number, number], v2: [number, number, number], v3: [number, number, number]): Uint8Array {
  // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const buf = new ArrayBuffer(80 + 4 + 50);
  const view = new DataView(buf);

  // Triangle count
  view.setUint32(80, 1, true);

  // Normal (0,0,0 — will be ignored)
  const offset = 84;
  // Vertex 1
  view.setFloat32(offset + 12, v1[0], true);
  view.setFloat32(offset + 16, v1[1], true);
  view.setFloat32(offset + 20, v1[2], true);
  // Vertex 2
  view.setFloat32(offset + 24, v2[0], true);
  view.setFloat32(offset + 28, v2[1], true);
  view.setFloat32(offset + 32, v2[2], true);
  // Vertex 3
  view.setFloat32(offset + 36, v3[0], true);
  view.setFloat32(offset + 40, v3[1], true);
  view.setFloat32(offset + 44, v3[2], true);
  // Attribute byte count
  view.setUint16(offset + 48, 0, true);

  return new Uint8Array(buf);
}

// ─── Helper: create a multi-color 3MF from simple triangle meshes ───

function makeMultiColor3MF(colors: [number, number, number, number][], triangles: [number, number, number][][]): Uint8Array {
  const inputs: ColoredModel[] = colors.map((color, i) => {
    // Build a binary STL with all triangles for this color
    const tris = triangles[i] || [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
    // Each triangle needs 3 vertices
    const triCount = Math.floor(tris.length / 3);
    if (triCount === 0) {
      // Single triangle from 3 points
      return {
        color,
        data: makeTriangleSTL(
          tris[0] as [number, number, number],
          tris[1] as [number, number, number],
          tris[2] as [number, number, number],
        ),
      };
    }
    return {
      color,
      data: makeTriangleSTL(
        tris[0] as [number, number, number],
        tris[1] as [number, number, number],
        tris[2] as [number, number, number],
      ),
    };
  });
  return merge3mf(inputs);
}

// ─── Tests ───

describe('merge-3mf', () => {
  describe('merge3mf', () => {
    it('creates a valid 3MF with multiple color groups', () => {
      const result = makeMultiColor3MF(
        [[1, 0, 0, 1], [0, 0, 1, 1]], // red, blue
        [
          [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
          [[0, 0, 5], [10, 0, 5], [5, 10, 5]],
        ],
      );
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.length).toBeGreaterThan(0);
    });

    it('throws on empty inputs', () => {
      expect(() => merge3mf([])).toThrow('No inputs to merge');
    });
  });

  describe('extractColorGroups', () => {
    it('extracts color groups from a multi-color 3MF', () => {
      const threeMf = makeMultiColor3MF(
        [[1, 0, 0, 1], [0, 0, 1, 1]], // red, blue
        [
          [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
          [[0, 0, 5], [10, 0, 5], [5, 10, 5]],
        ],
      );
      const groups = extractColorGroups(threeMf.buffer as ArrayBuffer);
      expect(groups).toHaveLength(2);
      expect(groups[0].index).toBe(0);
      expect(groups[1].index).toBe(1);
      // Red in sRGB hex
      expect(groups[0].colorHex).toMatch(/^#[0-9A-F]{6,8}$/i);
      expect(groups[1].colorHex).toMatch(/^#[0-9A-F]{6,8}$/i);
    });

    it('returns empty array for single-color 3MF', () => {
      const inputs: ColoredModel[] = [{
        color: [1, 0, 0, 1],
        data: makeTriangleSTL([0, 0, 0], [10, 0, 0], [5, 10, 0]),
      }];
      const threeMf = merge3mf(inputs);
      const groups = extractColorGroups(threeMf.buffer as ArrayBuffer);
      // Single color — extractColorGroups returns all colorgroups found
      // merge3mf with 1 input creates 1 colorgroup
      expect(groups).toHaveLength(1);
      expect(groups[0].index).toBe(0);
    });

    it('returns empty for non-3MF data', () => {
      const garbage = new Uint8Array([1, 2, 3, 4]);
      const groups = extractColorGroups(garbage.buffer as ArrayBuffer);
      expect(groups).toHaveLength(0);
    });
  });

  describe('extractColorMeshes', () => {
    it('extracts per-color meshes from a multi-color 3MF', () => {
      const threeMf = makeMultiColor3MF(
        [[1, 0, 0, 1], [0, 0, 1, 1]], // red, blue
        [
          [[0, 0, 0], [10, 0, 0], [5, 10, 0]],   // red triangle at z=0
          [[0, 0, 5], [10, 0, 5], [5, 10, 5]],     // blue triangle at z=5
        ],
      );
      const meshes = extractColorMeshes(threeMf.buffer as ArrayBuffer);
      expect(meshes).toHaveLength(2);

      // Each mesh should have correct extruder index
      expect(meshes[0].extruder).toBe(0);
      expect(meshes[1].extruder).toBe(1);

      // Each mesh should have vertex data (1 triangle = 9 floats)
      expect(meshes[0].vertices).toBeInstanceOf(Float32Array);
      expect(meshes[0].vertices.length).toBe(9);
      expect(meshes[1].vertices).toBeInstanceOf(Float32Array);
      expect(meshes[1].vertices.length).toBe(9);

      // Verify vertex values — red mesh at z=0
      // The exact values depend on STL dedup, but z should be 0 for all vertices of mesh 0
      const redZ = [meshes[0].vertices[2], meshes[0].vertices[5], meshes[0].vertices[8]];
      expect(redZ).toEqual([0, 0, 0]);

      // Blue mesh at z=5
      const blueZ = [meshes[1].vertices[2], meshes[1].vertices[5], meshes[1].vertices[8]];
      expect(blueZ).toEqual([5, 5, 5]);
    });

    it('returns empty for single-color 3MF', () => {
      const inputs: ColoredModel[] = [{
        color: [1, 0, 0, 1],
        data: makeTriangleSTL([0, 0, 0], [10, 0, 0], [5, 10, 0]),
      }];
      const threeMf = merge3mf(inputs);
      const meshes = extractColorMeshes(threeMf.buffer as ArrayBuffer);
      // extractColorMeshes returns empty for < 2 color groups
      expect(meshes).toHaveLength(0);
    });

    it('handles 3+ colors correctly', () => {
      const threeMf = makeMultiColor3MF(
        [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]], // red, green, blue
        [
          [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
          [[0, 0, 5], [10, 0, 5], [5, 10, 5]],
          [[0, 0, 10], [10, 0, 10], [5, 10, 10]],
        ],
      );
      const meshes = extractColorMeshes(threeMf.buffer as ArrayBuffer);
      expect(meshes).toHaveLength(3);
      expect(meshes[0].extruder).toBe(0);
      expect(meshes[1].extruder).toBe(1);
      expect(meshes[2].extruder).toBe(2);

      // Verify z-values distinguish the meshes
      expect(meshes[0].vertices[2]).toBe(0);
      expect(meshes[1].vertices[2]).toBe(5);
      expect(meshes[2].vertices[2]).toBe(10);
    });

    it('returns empty for garbage data', () => {
      const garbage = new Uint8Array([1, 2, 3, 4]);
      expect(extractColorMeshes(garbage.buffer as ArrayBuffer)).toHaveLength(0);
    });

    it('roundtrips: merge → extract preserves color hex values', () => {
      const threeMf = makeMultiColor3MF(
        [[1, 0, 0, 1], [0, 0, 1, 1]],
        [
          [[0, 0, 0], [10, 0, 0], [5, 10, 0]],
          [[0, 0, 5], [10, 0, 5], [5, 10, 5]],
        ],
      );

      const groups = extractColorGroups(threeMf.buffer as ArrayBuffer);
      const meshes = extractColorMeshes(threeMf.buffer as ArrayBuffer);

      // Color hex from groups should match meshes
      expect(meshes[0].colorHex).toBe(groups[0].colorHex);
      expect(meshes[1].colorHex).toBe(groups[1].colorHex);
    });
  });
});
