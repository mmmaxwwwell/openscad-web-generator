// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBuildPlate } from '../useBuildPlate';
import type { AddObjectOptions } from '../useBuildPlate';
import { DEFAULT_PRINT_PROFILE } from '../../types/print-profile';

// @vitest-environment jsdom

// ── Mock IndexedDB (idb module) ──────────────────────────────────────

const mockStore: Record<string, Record<string, unknown>> = {};

/** Delay in ms for openDB resolution — set > 0 to simulate real async IDB */
let openDBDelay = 0;

vi.mock('idb', () => ({
  openDB: vi.fn(() => {
    const db = {
      get: vi.fn(
        (store: string, key: string) =>
          Promise.resolve(mockStore[store]?.[key]),
      ),
      put: vi.fn((store: string, value: unknown, key?: string) => {
        if (!mockStore[store]) mockStore[store] = {};
        const k =
          key ??
          (typeof value === 'object' && value !== null && 'key' in value
            ? (value as { key: string }).key
            : String(key));
        mockStore[store][k] = value;
        return Promise.resolve();
      }),
      transaction: vi.fn(() => ({
        store: {
          put: vi.fn((value: unknown, key: string) => {
            if (!mockStore['plate-meshes']) mockStore['plate-meshes'] = {};
            mockStore['plate-meshes'][key] = value;
            return Promise.resolve();
          }),
        },
        done: Promise.resolve(),
      })),
      objectStoreNames: { contains: () => false },
    };
    if (openDBDelay > 0) {
      return new Promise(resolve => setTimeout(() => resolve(db), openDBDelay));
    }
    return Promise.resolve(db);
  }),
}));

// ── Mock autoArrangeObjects ──────────────────────────────────────────

vi.mock('../../lib/plate-slicer', () => ({
  autoArrangeObjects: vi.fn(
    (objects: Array<{ position: { x: number; y: number } }>) =>
      objects.map((o, i) => ({
        ...o,
        position: { x: i * 40, y: 0 },
      })),
  ),
}));

// ── Mock extractColorGroups (used by add3MFFile) ────────────────────

const mockExtractColorGroups = vi.fn(() => [] as Array<{ index: number; colorHex: string }>);
vi.mock('../../lib/merge-3mf', () => ({
  extractColorGroups: (...args: unknown[]) => mockExtractColorGroups(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────

const BED_W = 220;
const BED_D = 220;
const MAX_H = 250;

function makeSTL(size = 16): ArrayBuffer {
  return new ArrayBuffer(size);
}

function defaultOpts(overrides: Partial<AddObjectOptions> = {}): AddObjectOptions {
  return {
    type: 'stl',
    meshData: makeSTL(),
    meshFormat: 'stl',
    ...overrides,
  };
}

function setup(originCenter = false) {
  return renderHook(() => useBuildPlate(BED_W, BED_D, MAX_H, originCenter));
}

// ── Tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  // Clear mock IDB stores between tests
  for (const key of Object.keys(mockStore)) delete mockStore[key];
});

describe('useBuildPlate', () => {
  // ── Initial state ─────────────────────────────────────────────────

  describe('initial state', () => {
    it('sets loaded to true after IndexedDB load completes', async () => {
      const { result } = setup();
      await vi.waitFor(() => {
        expect(result.current.loaded).toBe(true);
      });
    });

    it('sets loaded to true even after strict-mode remount cycle', async () => {
      // Simulate React Strict Mode: mount → unmount → mount
      const { result, unmount } = setup();
      unmount();
      // Re-mount with fresh hook
      const { result: result2 } = setup();
      await vi.waitFor(() => {
        expect(result2.current.loaded).toBe(true);
      });
    });

    it('sets loaded to true with existing IDB data under StrictMode (async IDB)', async () => {
      // Use delayed openDB to simulate real browser timing where
      // the IDB promise resolves after React StrictMode cleanup runs.
      openDBDelay = 50;

      // Pre-populate mock IDB with plate data
      mockStore['plate-meta'] = {};
      mockStore['plate-meshes'] = {};
      const meshKey = 'mesh-obj-test-1';
      const meshData = new ArrayBuffer(16);
      mockStore['plate-meshes'][meshKey] = meshData;
      mockStore['plate-meta'][`plate-${BED_W}x${BED_D}`] = {
        key: `plate-${BED_W}x${BED_D}`,
        objects: [{
          id: 'obj-test-1',
          name: 'Test Object',
          type: 'stl' as const,
          meshFormat: 'stl' as const,
          meshDataKey: meshKey,
          position: { x: 100, y: 100 },
          rotation: 0,
          scale: { x: 1, y: 1, z: 1 },
          copies: 1,
        }],
        plateProfile: DEFAULT_PRINT_PROFILE,
        primeTower: { enabled: false, position: { x: 150, y: 150 }, width: 60, brimWidth: 3 },
        printSequence: 'by_layer' as const,
        bedWidth: BED_W,
        bedDepth: BED_D,
        maxHeight: MAX_H,
        originCenter: false,
        timestamp: Date.now(),
      };

      // Render in StrictMode (React 18+ double-mounts effects in dev)
      const React = await import('react');
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.StrictMode, null, children);
      const { result } = renderHook(
        () => useBuildPlate(BED_W, BED_D, MAX_H, false),
        { wrapper },
      );
      await vi.waitFor(() => {
        expect(result.current.loaded).toBe(true);
      }, { timeout: 3000 });
      // Should have rehydrated the saved object
      expect(result.current.objects).toHaveLength(1);
      expect(result.current.objects[0].name).toBe('Test Object');

      openDBDelay = 0;
    });

    it('sets loaded to true with no data even with slow IDB under StrictMode', async () => {
      openDBDelay = 100;

      const React = await import('react');
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(React.StrictMode, null, children);
      const { result } = renderHook(
        () => useBuildPlate(BED_W, BED_D, MAX_H, false),
        { wrapper },
      );
      await vi.waitFor(() => {
        expect(result.current.loaded).toBe(true);
      }, { timeout: 3000 });

      openDBDelay = 0;
    });

    it('sets loaded via safety timeout when IDB hangs', async () => {
      // openDB never resolves (simulates blocked/hung IDB)
      openDBDelay = 999999;
      vi.useFakeTimers();

      const { result } = setup();
      expect(result.current.loaded).toBe(false);

      // Advance past the 3s safety timeout
      await act(async () => {
        vi.advanceTimersByTime(3100);
      });

      expect(result.current.loaded).toBe(true);

      vi.useRealTimers();
      openDBDelay = 0;
    });

    it('starts with empty objects array', () => {
      const { result } = setup();
      expect(result.current.objects).toEqual([]);
    });

    it('starts with no selection', () => {
      const { result } = setup();
      expect(result.current.selectedObjectId).toBeNull();
      expect(result.current.selectedObject).toBeNull();
    });

    it('starts with default print profile', () => {
      const { result } = setup();
      expect(result.current.plateProfile).toEqual(DEFAULT_PRINT_PROFILE);
    });

    it('starts with prime tower disabled', () => {
      const { result } = setup();
      expect(result.current.primeTower.enabled).toBe(false);
    });

    it('starts with by_layer print sequence', () => {
      const { result } = setup();
      expect(result.current.printSequence).toBe('by_layer');
    });

    it('prime tower defaults to back-right position', () => {
      const { result } = setup();
      expect(result.current.primeTower.position.x).toBe(BED_W - 70);
      expect(result.current.primeTower.position.y).toBe(BED_D - 70);
    });
  });

  // ── addObject ─────────────────────────────────────────────────────

  describe('addObject', () => {
    it('adds an object and returns its id', () => {
      const { result } = setup();
      let id: string;
      act(() => {
        id = result.current.addObject(defaultOpts());
      });
      expect(id!).toBeTruthy();
      expect(result.current.objects).toHaveLength(1);
      expect(result.current.objects[0].id).toBe(id!);
    });

    it('auto-generates name "Object 1", "Object 2"', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects[0].name).toBe('Object 1');
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects[1].name).toBe('Object 2');
    });

    it('uses provided name instead of auto-generated', () => {
      const { result } = setup();
      act(() => {
        result.current.addObject(defaultOpts({ name: 'My Part' }));
      });
      expect(result.current.objects[0].name).toBe('My Part');
    });

    it('auto-selects the new object', () => {
      const { result } = setup();
      let id: string;
      act(() => {
        id = result.current.addObject(defaultOpts());
      });
      expect(result.current.selectedObjectId).toBe(id!);
      expect(result.current.selectedObject?.id).toBe(id!);
    });

    it('first object on non-center bed goes to bed center', () => {
      const { result } = setup(false);
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects[0].position).toEqual({
        x: BED_W / 2,
        y: BED_D / 2,
      });
    });

    it('first object on center-origin bed goes to (0,0)', () => {
      const { result } = setup(true);
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects[0].position).toEqual({ x: 0, y: 0 });
    });

    it('sets default rotation, scale, and copies', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      const obj = result.current.objects[0];
      expect(obj.rotation).toBe(0);
      expect(obj.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(obj.copies).toBe(1);
    });

    it('stores SCAD metadata', () => {
      const { result } = setup();
      act(() => {
        result.current.addObject(
          defaultOpts({
            type: 'scad',
            scadFileId: 'file-1',
            scadSource: 'cube(10);',
            scadParams: { size: 10 },
          }),
        );
      });
      const obj = result.current.objects[0];
      expect(obj.type).toBe('scad');
      expect(obj.scadFileId).toBe('file-1');
      expect(obj.scadSource).toBe('cube(10);');
      expect(obj.scadParams).toEqual({ size: 10 });
    });

    it('stores 3MF color groups', () => {
      const { result } = setup();
      const colors = [{ color: '#ff0000', name: 'Red' }];
      act(() => {
        result.current.addObject(
          defaultOpts({ type: '3mf', meshFormat: '3mf', colorGroups: colors }),
        );
      });
      expect(result.current.objects[0].colorGroups).toEqual(colors);
    });

    it('starts with no print overrides', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects[0].printOverrides).toBeUndefined();
    });
  });

  // ── removeObject ──────────────────────────────────────────────────

  describe('removeObject', () => {
    it('removes an object by id', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.removeObject(id!); });
      expect(result.current.objects).toHaveLength(0);
    });

    it('removes middle object from 3-object list', () => {
      const { result } = setup();
      const ids: string[] = [];
      act(() => {
        ids.push(result.current.addObject(defaultOpts({ name: 'A' })));
        ids.push(result.current.addObject(defaultOpts({ name: 'B' })));
        ids.push(result.current.addObject(defaultOpts({ name: 'C' })));
      });
      act(() => { result.current.removeObject(ids[1]); });
      expect(result.current.objects).toHaveLength(2);
      expect(result.current.objects.map((o) => o.name)).toEqual(['A', 'C']);
    });

    it('clears selection when selected object is removed', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      expect(result.current.selectedObjectId).toBe(id!);
      act(() => { result.current.removeObject(id!); });
      expect(result.current.selectedObjectId).toBeNull();
    });

    it('preserves selection when a different object is removed', () => {
      const { result } = setup();
      let id1: string, id2: string;
      act(() => {
        id1 = result.current.addObject(defaultOpts({ name: 'A' }));
        id2 = result.current.addObject(defaultOpts({ name: 'B' }));
      });
      // id2 is auto-selected (last added)
      expect(result.current.selectedObjectId).toBe(id2!);
      act(() => { result.current.removeObject(id1!); });
      expect(result.current.selectedObjectId).toBe(id2!);
    });

    it('does nothing for non-existent id', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.removeObject('non-existent'); });
      expect(result.current.objects).toHaveLength(1);
    });
  });

  // ── duplicateObject ───────────────────────────────────────────────

  describe('duplicateObject', () => {
    it('creates a copy with new id', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ name: 'Part' })); });
      let copyId: string | null;
      act(() => { copyId = result.current.duplicateObject(id!); });
      expect(copyId!).toBeTruthy();
      expect(copyId!).not.toBe(id!);
      expect(result.current.objects).toHaveLength(2);
    });

    it('appends " (copy)" to name', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ name: 'Part' })); });
      act(() => { result.current.duplicateObject(id!); });
      expect(result.current.objects[1].name).toBe('Part (copy)');
    });

    it('offsets position by 10mm in X and Y', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      const origPos = { ...result.current.objects[0].position };
      act(() => { result.current.duplicateObject(id!); });
      const copyPos = result.current.objects[1].position;
      expect(copyPos.x).toBe(origPos.x + 10);
      expect(copyPos.y).toBe(origPos.y + 10);
    });

    it('preserves print overrides but creates independent copy', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      act(() => { result.current.duplicateObject(id!); });
      expect(result.current.objects[1].printOverrides).toEqual({ wallLoops: 5 });
      // Mutating original overrides should not affect copy
      act(() => {
        result.current.updateObjectOverrides(id!, { infillDensity: 50 });
      });
      expect(result.current.objects[1].printOverrides).toEqual({ wallLoops: 5 });
    });

    it('auto-selects the copy', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      let copyId: string | null;
      act(() => { copyId = result.current.duplicateObject(id!); });
      expect(result.current.selectedObjectId).toBe(copyId!);
    });

    it('returns null for non-existent id', () => {
      const { result } = setup();
      let copyId: string | null;
      act(() => { copyId = result.current.duplicateObject('non-existent'); });
      expect(copyId!).toBeNull();
    });

    it('deep-clones meshData (independent ArrayBuffer)', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.duplicateObject(id!); });
      expect(result.current.objects[0].meshData).not.toBe(
        result.current.objects[1].meshData,
      );
    });
  });

  // ── updateObjectTransform ─────────────────────────────────────────

  describe('updateObjectTransform', () => {
    it('updates position only', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, {
          position: { x: 50, y: 75 },
        });
      });
      expect(result.current.objects[0].position).toEqual({ x: 50, y: 75 });
      expect(result.current.objects[0].rotation).toBe(0); // unchanged
    });

    it('updates rotation only', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, { rotation: 45 });
      });
      expect(result.current.objects[0].rotation).toBe(45);
    });

    it('updates scale only', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, {
          scale: { x: 2, y: 2, z: 2 },
        });
      });
      expect(result.current.objects[0].scale).toEqual({ x: 2, y: 2, z: 2 });
    });

    it('updates multiple transform fields at once', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, {
          position: { x: 10, y: 20 },
          rotation: 90,
          scale: { x: 1.5, y: 1.5, z: 1 },
        });
      });
      const obj = result.current.objects[0];
      expect(obj.position).toEqual({ x: 10, y: 20 });
      expect(obj.rotation).toBe(90);
      expect(obj.scale).toEqual({ x: 1.5, y: 1.5, z: 1 });
    });

    it('does not affect other objects', () => {
      const { result } = setup();
      let id1: string;
      act(() => {
        id1 = result.current.addObject(defaultOpts({ name: 'A' }));
        result.current.addObject(defaultOpts({ name: 'B' }));
      });
      const origPos = { ...result.current.objects[1].position };
      act(() => {
        result.current.updateObjectTransform(id1!, {
          position: { x: 100, y: 100 },
        });
      });
      expect(result.current.objects[1].position).toEqual(origPos);
    });
  });

  // ── updateObjectOverrides ─────────────────────────────────────────

  describe('updateObjectOverrides', () => {
    it('sets initial overrides', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      expect(result.current.objects[0].printOverrides).toEqual({
        wallLoops: 5,
      });
    });

    it('merges new overrides with existing (does not replace)', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      act(() => {
        result.current.updateObjectOverrides(id!, { infillDensity: 30 });
      });
      expect(result.current.objects[0].printOverrides).toEqual({
        wallLoops: 5,
        infillDensity: 30,
      });
    });

    it('overwrites existing override for same field', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 3 });
      });
      expect(result.current.objects[0].printOverrides?.wallLoops).toBe(3);
    });
  });

  // ── clearObjectOverrides ──────────────────────────────────────────

  describe('clearObjectOverrides', () => {
    it('resets overrides to undefined', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5, infillDensity: 30 });
      });
      expect(result.current.objects[0].printOverrides).toBeTruthy();
      act(() => { result.current.clearObjectOverrides(id!); });
      expect(result.current.objects[0].printOverrides).toBeUndefined();
    });
  });

  // ── setExtruderAssignment ─────────────────────────────────────────

  describe('setExtruderAssignment', () => {
    it('sets extruder assignment', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.setExtruderAssignment(id!, 2); });
      expect(result.current.objects[0].extruderAssignment).toBe(2);
    });

    it('updates existing extruder assignment', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.setExtruderAssignment(id!, 1); });
      act(() => { result.current.setExtruderAssignment(id!, 3); });
      expect(result.current.objects[0].extruderAssignment).toBe(3);
    });
  });

  // ── replaceObjectMesh ─────────────────────────────────────────────

  describe('replaceObjectMesh', () => {
    it('replaces mesh data and format', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      const newMesh = makeSTL(32);
      act(() => {
        result.current.replaceObjectMesh(id!, newMesh, '3mf');
      });
      expect(result.current.objects[0].meshData).toBe(newMesh);
      expect(result.current.objects[0].meshFormat).toBe('3mf');
    });

    it('preserves position and overrides', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, {
          position: { x: 50, y: 50 },
        });
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      act(() => {
        result.current.replaceObjectMesh(id!, makeSTL(32), 'stl');
      });
      expect(result.current.objects[0].position).toEqual({ x: 50, y: 50 });
      expect(result.current.objects[0].printOverrides).toEqual({ wallLoops: 5 });
    });

    it('updates color groups when provided', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      const colors = [{ color: '#00ff00' }];
      act(() => {
        result.current.replaceObjectMesh(id!, makeSTL(32), '3mf', colors);
      });
      expect(result.current.objects[0].colorGroups).toEqual(colors);
    });

    it('updates scadParams when provided', () => {
      const { result } = setup();
      let id: string;
      act(() => {
        id = result.current.addObject(
          defaultOpts({ type: 'scad', scadParams: { size: 10 } }),
        );
      });
      act(() => {
        result.current.replaceObjectMesh(
          id!,
          makeSTL(32),
          'stl',
          undefined,
          { size: 20 },
        );
      });
      expect(result.current.objects[0].scadParams).toEqual({ size: 20 });
    });
  });

  // ── Plate operations ──────────────────────────────────────────────

  describe('setPlateProfile', () => {
    it('merges partial profile updates', () => {
      const { result } = setup();
      act(() => { result.current.setPlateProfile({ wallLoops: 5 }); });
      expect(result.current.plateProfile.wallLoops).toBe(5);
      // Other fields unchanged
      expect(result.current.plateProfile.layerHeight).toBe(
        DEFAULT_PRINT_PROFILE.layerHeight,
      );
    });
  });

  describe('setPrimeTower', () => {
    it('merges partial prime tower updates', () => {
      const { result } = setup();
      act(() => { result.current.setPrimeTower({ enabled: true }); });
      expect(result.current.primeTower.enabled).toBe(true);
      // Other fields unchanged
      expect(result.current.primeTower.width).toBe(60);
    });
  });

  describe('setPrintSequence', () => {
    it('changes print sequence mode', () => {
      const { result } = setup();
      act(() => { result.current.setPrintSequence('by_object'); });
      expect(result.current.printSequence).toBe('by_object');
    });
  });

  describe('autoArrange', () => {
    it('updates object positions via autoArrangeObjects', () => {
      const { result } = setup();
      act(() => {
        result.current.addObject(defaultOpts({ name: 'A' }));
        result.current.addObject(defaultOpts({ name: 'B' }));
      });
      act(() => { result.current.autoArrange(); });
      // Mock returns x: i * 40
      expect(result.current.objects[0].position.x).toBe(0);
      expect(result.current.objects[1].position.x).toBe(40);
    });
  });

  describe('clearPlate', () => {
    it('removes all objects and clears selection', () => {
      const { result } = setup();
      act(() => {
        result.current.addObject(defaultOpts({ name: 'A' }));
        result.current.addObject(defaultOpts({ name: 'B' }));
      });
      expect(result.current.objects).toHaveLength(2);
      act(() => { result.current.clearPlate(); });
      expect(result.current.objects).toHaveLength(0);
      expect(result.current.selectedObjectId).toBeNull();
    });
  });

  // ── Selection ─────────────────────────────────────────────────────

  describe('selection', () => {
    it('selectObject sets selectedObjectId and selectedObject', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ name: 'A' })); });
      act(() => { result.current.addObject(defaultOpts({ name: 'B' })); });
      // B is selected (last added). Select A instead.
      act(() => { result.current.selectObject(id!); });
      expect(result.current.selectedObjectId).toBe(id!);
      expect(result.current.selectedObject?.name).toBe('A');
    });

    it('selectObject(null) deselects', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.selectObject(null); });
      expect(result.current.selectedObjectId).toBeNull();
      expect(result.current.selectedObject).toBeNull();
    });

    it('deselectAll clears selection', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.deselectAll(); });
      expect(result.current.selectedObjectId).toBeNull();
    });

    it('selectedObject is derived correctly', () => {
      const { result } = setup();
      let id1: string;
      act(() => {
        id1 = result.current.addObject(defaultOpts({ name: 'A' }));
        result.current.addObject(defaultOpts({ name: 'B' }));
      });
      act(() => { result.current.selectObject(id1!); });
      expect(result.current.selectedObject?.name).toBe('A');
    });
  });

  // ── addSTLFile ──────────────────────────────────────────────────────

  describe('addSTLFile', () => {
    function makeFile(name: string, size = 16): File {
      const buf = new ArrayBuffer(size);
      return new File([buf], name, { type: 'application/octet-stream' });
    }

    it('creates an STL object from a File', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.addSTLFile(makeFile('bracket.stl'));
      });
      expect(result.current.objects).toHaveLength(1);
      const obj = result.current.objects[0];
      expect(obj.type).toBe('stl');
      expect(obj.meshFormat).toBe('stl');
      expect(obj.meshData.byteLength).toBe(16);
    });

    it('strips .stl extension from filename for object name', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.addSTLFile(makeFile('My_Part.stl'));
      });
      expect(result.current.objects[0].name).toBe('My_Part');
    });

    it('strips .STL extension case-insensitively', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.addSTLFile(makeFile('part.STL'));
      });
      expect(result.current.objects[0].name).toBe('part');
    });

    it('auto-selects the added object', async () => {
      const { result } = setup();
      let id: string;
      await act(async () => {
        id = await result.current.addSTLFile(makeFile('test.stl'));
      });
      expect(result.current.selectedObjectId).toBe(id!);
    });

    it('returns the new object id', async () => {
      const { result } = setup();
      let id: string;
      await act(async () => {
        id = await result.current.addSTLFile(makeFile('test.stl'));
      });
      expect(id!).toBeTruthy();
      expect(result.current.objects[0].id).toBe(id!);
    });

    it('does not set colorGroups for STL files', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.addSTLFile(makeFile('test.stl'));
      });
      expect(result.current.objects[0].colorGroups).toBeUndefined();
    });
  });

  // ── add3MFFile ─────────────────────────────────────────────────────

  describe('add3MFFile', () => {
    function makeFile(name: string, size = 16): File {
      const buf = new ArrayBuffer(size);
      return new File([buf], name, { type: 'application/octet-stream' });
    }

    it('creates a 3MF object from a File', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.add3MFFile(makeFile('model.3mf'));
      });
      expect(result.current.objects).toHaveLength(1);
      const obj = result.current.objects[0];
      expect(obj.type).toBe('3mf');
      expect(obj.meshFormat).toBe('3mf');
    });

    it('strips .3mf extension from filename for object name', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.add3MFFile(makeFile('My_Model.3mf'));
      });
      expect(result.current.objects[0].name).toBe('My_Model');
    });

    it('extracts color groups via extractColorGroups', async () => {
      mockExtractColorGroups.mockReturnValueOnce([
        { index: 0, colorHex: '#FF0000' },
        { index: 1, colorHex: '#00FF00' },
      ]);
      const { result } = setup();
      await act(async () => {
        await result.current.add3MFFile(makeFile('multi.3mf'));
      });
      expect(mockExtractColorGroups).toHaveBeenCalled();
      expect(result.current.objects[0].colorGroups).toEqual([
        { color: '#FF0000' },
        { color: '#00FF00' },
      ]);
    });

    it('sets colorGroups to undefined when no colors found', async () => {
      mockExtractColorGroups.mockReturnValueOnce([]);
      const { result } = setup();
      await act(async () => {
        await result.current.add3MFFile(makeFile('plain.3mf'));
      });
      expect(result.current.objects[0].colorGroups).toBeUndefined();
    });

    it('auto-selects the added object', async () => {
      const { result } = setup();
      let id: string;
      await act(async () => {
        id = await result.current.add3MFFile(makeFile('test.3mf'));
      });
      expect(result.current.selectedObjectId).toBe(id!);
    });

    it('maps colorHex to color field in colorGroups', async () => {
      mockExtractColorGroups.mockReturnValueOnce([
        { index: 0, colorHex: '#AABBCC' },
      ]);
      const { result } = setup();
      await act(async () => {
        await result.current.add3MFFile(makeFile('test.3mf'));
      });
      // Should map { index, colorHex } to { color }
      const groups = result.current.objects[0].colorGroups!;
      expect(groups[0]).toEqual({ color: '#AABBCC' });
      expect(groups[0]).not.toHaveProperty('colorHex');
      expect(groups[0]).not.toHaveProperty('index');
    });
  });

  // ── mirrorObject ──────────────────────────────────────────────────

  describe('mirrorObject', () => {
    it('negates X scale when mirroring on X axis', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.mirrorObject(id!, 'x'); });
      expect(result.current.objects[0].scale).toEqual({ x: -1, y: 1, z: 1 });
    });

    it('negates Y scale when mirroring on Y axis', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.mirrorObject(id!, 'y'); });
      expect(result.current.objects[0].scale).toEqual({ x: 1, y: -1, z: 1 });
    });

    it('negates Z scale when mirroring on Z axis', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.mirrorObject(id!, 'z'); });
      expect(result.current.objects[0].scale).toEqual({ x: 1, y: 1, z: -1 });
    });

    it('double mirror restores original scale', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.mirrorObject(id!, 'x'); });
      act(() => { result.current.mirrorObject(id!, 'x'); });
      expect(result.current.objects[0].scale).toEqual({ x: 1, y: 1, z: 1 });
    });

    it('preserves existing non-unit scale', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectTransform(id!, {
          scale: { x: 2, y: 3, z: 0.5 },
        });
      });
      act(() => { result.current.mirrorObject(id!, 'y'); });
      expect(result.current.objects[0].scale).toEqual({ x: 2, y: -3, z: 0.5 });
    });

    it('does not affect other objects', () => {
      const { result } = setup();
      let id1: string;
      act(() => {
        id1 = result.current.addObject(defaultOpts({ name: 'A' }));
        result.current.addObject(defaultOpts({ name: 'B' }));
      });
      act(() => { result.current.mirrorObject(id1!, 'x'); });
      expect(result.current.objects[1].scale).toEqual({ x: 1, y: 1, z: 1 });
    });
  });

  // ── arrayCopyObject ───────────────────────────────────────────────

  describe('arrayCopyObject', () => {
    it('creates (rows*cols - 1) copies', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ name: 'Part' })); });
      let ids: string[];
      act(() => { ids = result.current.arrayCopyObject(id!, 2, 3, 40, 40); });
      // 2*3 - 1 = 5 copies
      expect(ids!).toHaveLength(5);
      expect(result.current.objects).toHaveLength(6); // 1 original + 5 copies
    });

    it('positions copies in grid pattern', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      const origPos = { ...result.current.objects[0].position };
      act(() => { result.current.arrayCopyObject(id!, 2, 2, 50, 60); });
      // Copies: (0,1), (1,0), (1,1) — skipping (0,0) which is original
      const copies = result.current.objects.slice(1);
      expect(copies[0].position).toEqual({ x: origPos.x + 50, y: origPos.y });
      expect(copies[1].position).toEqual({ x: origPos.x, y: origPos.y + 60 });
      expect(copies[2].position).toEqual({ x: origPos.x + 50, y: origPos.y + 60 });
    });

    it('names copies with grid coordinates', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ name: 'Part' })); });
      act(() => { result.current.arrayCopyObject(id!, 2, 2, 40, 40); });
      const copies = result.current.objects.slice(1);
      expect(copies[0].name).toBe('Part (1,2)');
      expect(copies[1].name).toBe('Part (2,1)');
      expect(copies[2].name).toBe('Part (2,2)');
    });

    it('returns empty array for non-existent id', () => {
      const { result } = setup();
      let ids: string[];
      act(() => { ids = result.current.arrayCopyObject('bad-id', 2, 2, 40, 40); });
      expect(ids!).toEqual([]);
    });

    it('returns empty array for 1x1 grid (no copies needed)', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      let ids: string[];
      act(() => { ids = result.current.arrayCopyObject(id!, 1, 1, 40, 40); });
      expect(ids!).toEqual([]);
      expect(result.current.objects).toHaveLength(1);
    });

    it('copies preserve print overrides independently', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.updateObjectOverrides(id!, { wallLoops: 5 }); });
      act(() => { result.current.arrayCopyObject(id!, 1, 2, 40, 40); });
      expect(result.current.objects[1].printOverrides).toEqual({ wallLoops: 5 });
      // Mutating original doesn't affect copy
      act(() => { result.current.updateObjectOverrides(id!, { infillDensity: 50 }); });
      expect(result.current.objects[1].printOverrides).toEqual({ wallLoops: 5 });
    });

    it('copies have independent mesh data', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => { result.current.arrayCopyObject(id!, 1, 2, 40, 40); });
      expect(result.current.objects[1].meshData).not.toBe(
        result.current.objects[0].meshData,
      );
      expect(result.current.objects[1].meshData.byteLength).toBe(
        result.current.objects[0].meshData.byteLength,
      );
    });
  });

  // ── Undo / redo ─────────────────────────────────────────────────────

  describe('undo/redo', () => {
    it('canUndo is false initially', () => {
      const { result } = setup();
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(false);
    });

    it('canUndo becomes true after a mutation', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);
    });

    it('undo reverses addObject', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects.length).toBe(1);
      act(() => { result.current.undo(); });
      expect(result.current.objects.length).toBe(0);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.canRedo).toBe(true);
    });

    it('redo re-applies undone addObject', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.undo(); });
      expect(result.current.objects.length).toBe(0);
      act(() => { result.current.redo(); });
      expect(result.current.objects.length).toBe(1);
      expect(result.current.canUndo).toBe(true);
      expect(result.current.canRedo).toBe(false);
    });

    it('undo reverses removeObject and restores mesh data', () => {
      const { result } = setup();
      const meshData = makeSTL(32);
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts({ meshData })); });
      act(() => { result.current.removeObject(id!); });
      expect(result.current.objects.length).toBe(0);
      act(() => { result.current.undo(); });
      expect(result.current.objects.length).toBe(1);
      expect(result.current.objects[0].meshData.byteLength).toBe(32);
    });

    it('undo reverses updateObjectTransform', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      const origPos = { ...result.current.objects[0].position };
      act(() => {
        result.current.updateObjectTransform(id!, {
          position: { x: 100, y: 50 },
        });
      });
      expect(result.current.objects[0].position).toEqual({ x: 100, y: 50 });
      act(() => { result.current.undo(); });
      expect(result.current.objects[0].position).toEqual(origPos);
    });

    it('undo reverses updateObjectOverrides', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      act(() => {
        result.current.updateObjectOverrides(id!, { wallLoops: 5 });
      });
      expect(result.current.objects[0].printOverrides?.wallLoops).toBe(5);
      act(() => { result.current.undo(); });
      expect(result.current.objects[0].printOverrides).toBeUndefined();
    });

    it('undo reverses mirrorObject', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      expect(result.current.objects[0].scale.x).toBe(1);
      act(() => { result.current.mirrorObject(id!, 'x'); });
      expect(result.current.objects[0].scale.x).toBe(-1);
      act(() => { result.current.undo(); });
      expect(result.current.objects[0].scale.x).toBe(1);
    });

    it('undo reverses clearPlate', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.objects.length).toBe(2);
      act(() => { result.current.clearPlate(); });
      expect(result.current.objects.length).toBe(0);
      act(() => { result.current.undo(); });
      expect(result.current.objects.length).toBe(2);
    });

    it('new mutation clears redo stack', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.undo(); });
      expect(result.current.canRedo).toBe(true);
      // New mutation should clear redo
      act(() => { result.current.addObject(defaultOpts()); });
      expect(result.current.canRedo).toBe(false);
    });

    it('undo restores selection state', () => {
      const { result } = setup();
      let id: string;
      act(() => { id = result.current.addObject(defaultOpts()); });
      expect(result.current.selectedObjectId).toBe(id!);
      act(() => { result.current.undo(); });
      // Before add, selectedObjectId was null
      expect(result.current.selectedObjectId).toBeNull();
    });

    it('stack is capped at 50 entries', () => {
      const { result } = setup();
      // Push 55 mutations
      for (let i = 0; i < 55; i++) {
        act(() => { result.current.addObject(defaultOpts()); });
      }
      // Undo 50 times should work
      for (let i = 0; i < 50; i++) {
        act(() => { result.current.undo(); });
      }
      expect(result.current.canUndo).toBe(false);
      // We had 55 objects, undid 50, so 5 remain
      expect(result.current.objects.length).toBe(5);
    });

    it('undo with no history is a no-op', () => {
      const { result } = setup();
      act(() => { result.current.undo(); });
      expect(result.current.objects.length).toBe(0);
    });

    it('redo with no history is a no-op', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts()); });
      act(() => { result.current.redo(); });
      expect(result.current.objects.length).toBe(1);
    });

    it('multiple undo/redo cycles work correctly', () => {
      const { result } = setup();
      act(() => { result.current.addObject(defaultOpts({ name: 'A' })); });
      act(() => { result.current.addObject(defaultOpts({ name: 'B' })); });
      expect(result.current.objects.length).toBe(2);

      act(() => { result.current.undo(); }); // remove B
      expect(result.current.objects.length).toBe(1);
      expect(result.current.objects[0].name).toBe('A');

      act(() => { result.current.undo(); }); // remove A
      expect(result.current.objects.length).toBe(0);

      act(() => { result.current.redo(); }); // restore A
      expect(result.current.objects.length).toBe(1);
      expect(result.current.objects[0].name).toBe('A');

      act(() => { result.current.redo(); }); // restore B
      expect(result.current.objects.length).toBe(2);
    });
  });
});
