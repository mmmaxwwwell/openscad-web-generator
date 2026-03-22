// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { openDB, type IDBPDatabase } from 'idb';
import type {
  BuildPlateObject,
  BuildPlateObjectType,
  FlushVolumeConfig,
  MeshFormat,
  PrimeTowerConfig,
  PrintSequence,
} from '../types/build-plate';
import type { ScadParam, ScadValue } from '../types';
import type { PrintProfile } from '../types/print-profile';
import { DEFAULT_PRINT_PROFILE } from '../types/print-profile';
import { autoArrangeObjects } from '../lib/plate-slicer';
import { extractColorGroups } from '../lib/merge-3mf';

// ── IndexedDB persistence ──────────────────────────────────────────────

const DB_NAME = 'openscad-build-plate';
const DB_VERSION = 1;
const META_STORE = 'plate-meta';
const MESH_STORE = 'plate-meshes';

interface PlateMeta {
  key: string;
  objects: SerializedObject[];
  plateProfile: PrintProfile;
  primeTower: PrimeTowerConfig;
  flushVolumeConfig?: FlushVolumeConfig;
  printSequence: PrintSequence;
  bedWidth: number;
  bedDepth: number;
  maxHeight: number;
  originCenter: boolean;
  timestamp: number;
}

/** BuildPlateObject with meshData replaced by a reference key */
type SerializedObject = Omit<BuildPlateObject, 'meshData'> & {
  meshDataKey: string;
};

function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(MESH_STORE)) {
        db.createObjectStore(MESH_STORE);
      }
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

let nextId = 1;
export function generateId(): string {
  return `obj-${Date.now()}-${nextId++}`;
}

export function generateName(objects: BuildPlateObject[], baseName?: string): string {
  if (baseName) return baseName;
  const existing = objects.filter((o) => /^Object \d+$/.test(o.name));
  const maxNum = existing.reduce((max, o) => {
    const m = o.name.match(/^Object (\d+)$/);
    return m ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  return `Object ${maxNum + 1}`;
}

export function cloneObject(obj: BuildPlateObject, offset = 10): BuildPlateObject {
  return {
    ...obj,
    id: generateId(),
    name: `${obj.name} (copy)`,
    position: { x: obj.position.x + offset, y: obj.position.y + offset },
    meshData: obj.meshData.slice(0),
    printOverrides: obj.printOverrides ? { ...obj.printOverrides } : undefined,
    scadParams: obj.scadParams ? { ...obj.scadParams } : undefined,
    colorGroups: obj.colorGroups ? [...obj.colorGroups] : undefined,
  };
}

// ── Undo/redo types ─────────────────────────────────────────────────────

const UNDO_STACK_MAX = 50;

/** Lightweight snapshot of one object — everything EXCEPT meshData */
type ObjectSnapshot = Omit<BuildPlateObject, 'meshData'>;

/** Lightweight snapshot of the full plate state */
interface PlateSnapshot {
  objects: ObjectSnapshot[];
  selectedObjectId: string | null;
}

function snapshotObjects(objects: BuildPlateObject[], selectedObjectId: string | null): PlateSnapshot {
  return {
    objects: objects.map(({ meshData: _meshData, ...rest }) => ({
      ...rest,
      // Deep-clone overrides & params so undo restores exact values
      printOverrides: rest.printOverrides ? { ...rest.printOverrides } : undefined,
      scadParams: rest.scadParams ? { ...rest.scadParams } : undefined,
      colorGroups: rest.colorGroups ? [...rest.colorGroups] : undefined,
      position: { ...rest.position },
      scale: { ...rest.scale },
    })),
    selectedObjectId,
  };
}

// ── Hook types ──────────────────────────────────────────────────────────

export interface AddObjectOptions {
  name?: string;
  type: BuildPlateObjectType;
  meshData: ArrayBuffer;
  meshFormat: MeshFormat;
  colorGroups?: Array<{ color: string; name?: string }>;
  scadFileId?: string;
  scadSource?: string;
  scadParams?: Record<string, ScadValue>;
  scadParamDefs?: ScadParam[];
}

export interface UseBuildPlateResult {
  // State
  objects: BuildPlateObject[];
  selectedObjectId: string | null;
  selectedObject: BuildPlateObject | null;
  plateProfile: PrintProfile;
  primeTower: PrimeTowerConfig;
  flushVolumeConfig: FlushVolumeConfig | undefined;
  printSequence: PrintSequence;
  loaded: boolean;

  // File import (async convenience methods)
  addSTLFile: (file: File) => Promise<string>;
  add3MFFile: (file: File) => Promise<string>;

  // Object CRUD
  addObject: (options: AddObjectOptions) => string;
  removeObject: (id: string) => void;
  duplicateObject: (id: string) => string | null;
  updateObjectTransform: (
    id: string,
    transform: Partial<{
      position: { x: number; y: number };
      rotation: number;
      scale: { x: number; y: number; z: number };
    }>,
  ) => void;
  updateObjectOverrides: (id: string, overrides: Partial<PrintProfile>) => void;
  clearObjectOverrides: (id: string) => void;
  setExtruderAssignment: (id: string, extruder: number) => void;
  replaceObjectMesh: (
    id: string,
    meshData: ArrayBuffer,
    meshFormat: MeshFormat,
    colorGroups?: Array<{ color: string; name?: string }>,
    scadParams?: Record<string, ScadValue>,
  ) => void;

  // Mirror & array copy
  mirrorObject: (id: string, axis: 'x' | 'y' | 'z') => void;
  arrayCopyObject: (
    id: string,
    rows: number,
    cols: number,
    spacingX: number,
    spacingY: number,
  ) => string[];

  // Plate operations
  setPlateProfile: (updates: Partial<PrintProfile>) => void;
  setPrimeTower: (updates: Partial<PrimeTowerConfig>) => void;
  setFlushVolumeConfig: (config: FlushVolumeConfig | undefined) => void;
  setPrintSequence: (mode: PrintSequence) => void;
  autoArrange: () => void;
  clearPlate: () => void;

  // Selection
  selectObject: (id: string | null) => void;
  deselectAll: () => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// ── Default plate config ────────────────────────────────────────────────

const DEFAULT_PRIME_TOWER: PrimeTowerConfig = {
  enabled: false,
  position: { x: 0, y: 0 },
  width: 60,
  brimWidth: 3,
};

// ── Hook ────────────────────────────────────────────────────────────────

export function useBuildPlate(
  bedWidth: number,
  bedDepth: number,
  maxHeight: number,
  originCenter: boolean,
): UseBuildPlateResult {
  const [objects, setObjects] = useState<BuildPlateObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [plateProfile, setPlateProfileState] = useState<PrintProfile>(DEFAULT_PRINT_PROFILE);
  const [primeTower, setPrimeTowerState] = useState<PrimeTowerConfig>({
    ...DEFAULT_PRIME_TOWER,
    position: { x: bedWidth - 70, y: bedDepth - 70 },
  });
  const [flushVolumeConfig, setFlushVolumeConfigState] = useState<FlushVolumeConfig | undefined>(undefined);
  const [printSequence, setPrintSequenceState] = useState<PrintSequence>('by_layer');
  const [loaded, setLoaded] = useState(false);

  const mountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Undo/redo state ────────────────────────────────────────────────

  const undoStackRef = useRef<PlateSnapshot[]>([]);
  const redoStackRef = useRef<PlateSnapshot[]>([]);
  // Mesh data store — maps objectId → ArrayBuffer, persisted across undo/redo
  const meshStoreRef = useRef<Map<string, ArrayBuffer>>(new Map());
  // Counter to force re-render when undo/redo stack sizes change
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [undoVersion, setUndoVersion] = useState(0);

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  /** Snapshot current objects state and push onto undo stack */
  const pushUndo = useCallback(() => {
    undoStackRef.current.push(snapshotObjects(objects, selectedObjectId));
    if (undoStackRef.current.length > UNDO_STACK_MAX) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = []; // any new mutation clears redo
    // Store mesh data for all current objects so undo can restore them
    for (const obj of objects) {
      meshStoreRef.current.set(obj.id, obj.meshData);
    }
    setUndoVersion((v) => v + 1);
  }, [objects, selectedObjectId]);

  /** Restore a snapshot, returning the rehydrated objects */
  const restoreSnapshot = useCallback((snapshot: PlateSnapshot): BuildPlateObject[] => {
    return snapshot.objects.map((snap) => ({
      ...snap,
      meshData: meshStoreRef.current.get(snap.id) ?? new ArrayBuffer(0),
    }));
  }, []);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    // Push current state to redo
    redoStackRef.current.push(snapshotObjects(objects, selectedObjectId));
    // Pop and restore from undo
    const snapshot = undoStackRef.current.pop()!;
    const restored = restoreSnapshot(snapshot);
    setObjects(restored);
    setSelectedObjectId(snapshot.selectedObjectId);
    setUndoVersion((v) => v + 1);
  }, [objects, selectedObjectId, restoreSnapshot]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    // Push current state to undo
    undoStackRef.current.push(snapshotObjects(objects, selectedObjectId));
    // Pop and restore from redo
    const snapshot = redoStackRef.current.pop()!;
    const restored = restoreSnapshot(snapshot);
    setObjects(restored);
    setSelectedObjectId(snapshot.selectedObjectId);
    setUndoVersion((v) => v + 1);
  }, [objects, selectedObjectId, restoreSnapshot]);

  // Keep mesh store updated when objects change (e.g., after replaceObjectMesh)
  useEffect(() => {
    for (const obj of objects) {
      meshStoreRef.current.set(obj.id, obj.meshData);
    }
  }, [objects]);

  // Persist plate key based on bed dimensions (one plate per printer bed config)
  const plateKey = `plate-${bedWidth}x${bedDepth}`;

  // ── Derived state ───────────────────────────────────────────────────

  const selectedObject = useMemo(
    () => objects.find((o) => o.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );

  // ── Persistence: load ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let didLoad = false;

    async function load() {
      try {
        const db = await getDb();
        const meta: PlateMeta | undefined = await db.get(META_STORE, plateKey);
        if (cancelled || !meta) {
          if (!cancelled) { didLoad = true; setLoaded(true); }
          return;
        }

        // Rehydrate objects with mesh data from blob store
        const rehydrated: BuildPlateObject[] = [];
        for (const serialized of meta.objects) {
          const meshData: ArrayBuffer | undefined = await db.get(
            MESH_STORE,
            serialized.meshDataKey,
          );
          if (meshData) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { meshDataKey, ...rest } = serialized;
            rehydrated.push({ ...rest, meshData } as BuildPlateObject);
          }
        }

        if (!cancelled) {
          didLoad = true;
          setObjects(rehydrated);
          setPlateProfileState(meta.plateProfile);
          setPrimeTowerState(meta.primeTower);
          setFlushVolumeConfigState(meta.flushVolumeConfig);
          setPrintSequenceState(meta.printSequence);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) { didLoad = true; setLoaded(true); }
      }
    }

    // Safety timeout: if IDB is blocked/hung, still allow the UI to load
    const timeout = setTimeout(() => {
      if (!cancelled && !didLoad) {
        console.warn('[useBuildPlate] IDB load timed out, proceeding without saved data');
        didLoad = true;
        setLoaded(true);
      }
    }, 3000);

    load();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [plateKey]);

  // ── Persistence: save (debounced) ───────────────────────────────────

  const scheduleSave = useCallback(
    (
      newObjects: BuildPlateObject[],
      newProfile: PrintProfile,
      newPrimeTower: PrimeTowerConfig,
      newFlushVolumeConfig: FlushVolumeConfig | undefined,
      newPrintSequence: PrintSequence,
    ) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          const db = await getDb();

          // Store mesh data as separate blobs
          const serializedObjects: SerializedObject[] = [];
          const tx = db.transaction(MESH_STORE, 'readwrite');
          for (const obj of newObjects) {
            const meshDataKey = `mesh-${obj.id}`;
            await tx.store.put(obj.meshData, meshDataKey);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { meshData, ...rest } = obj;
            serializedObjects.push({ ...rest, meshDataKey });
          }
          await tx.done;

          // Store metadata
          const meta: PlateMeta = {
            key: plateKey,
            objects: serializedObjects,
            plateProfile: newProfile,
            primeTower: newPrimeTower,
            flushVolumeConfig: newFlushVolumeConfig,
            printSequence: newPrintSequence,
            bedWidth,
            bedDepth,
            maxHeight,
            originCenter,
            timestamp: Date.now(),
          };
          await db.put(META_STORE, meta);
        } catch {
          // Silently fail — persistence is best-effort
        }
      }, 500);
    },
    [plateKey, bedWidth, bedDepth, maxHeight, originCenter],
  );

  // Trigger save whenever state changes (after initial load)
  useEffect(() => {
    if (!loaded) return;
    scheduleSave(objects, plateProfile, primeTower, flushVolumeConfig, printSequence);
  }, [objects, plateProfile, primeTower, flushVolumeConfig, printSequence, loaded, scheduleSave]);

  // ── Mounted tracking & cleanup ──────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ── Object CRUD ─────────────────────────────────────────────────────

  const addObject = useCallback(
    (options: AddObjectOptions): string => {
      pushUndo();
      const id = generateId();
      const newObj: BuildPlateObject = {
        id,
        name: generateName(objects, options.name),
        type: options.type,
        meshData: options.meshData,
        meshFormat: options.meshFormat,
        colorGroups: options.colorGroups,
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1, z: 1 },
        scadFileId: options.scadFileId,
        scadSource: options.scadSource,
        scadParams: options.scadParams,
        scadParamDefs: options.scadParamDefs,
        printOverrides: undefined,
        extruderAssignment: undefined,
        copies: 1,
      };

      setObjects((prev) => {
        const updated = [...prev, newObj];
        // Auto-position: find empty spot using auto-arrange
        if (prev.length > 0) {
          const arranged = autoArrangeObjects(updated, bedWidth, bedDepth, originCenter);
          // Apply the position of the last object (our new one)
          const lastArranged = arranged[arranged.length - 1];
          if (lastArranged) {
            newObj.position = lastArranged.position;
          }
        } else if (originCenter) {
          newObj.position = { x: 0, y: 0 };
        } else {
          newObj.position = { x: bedWidth / 2, y: bedDepth / 2 };
        }
        return [...prev, newObj];
      });
      setSelectedObjectId(id);
      return id;
    },
    [objects, bedWidth, bedDepth, originCenter, pushUndo],
  );

  // ── File import convenience methods ─────────────────────────────────

  const addSTLFile = useCallback(
    async (file: File): Promise<string> => {
      const data = await file.arrayBuffer();
      return addObject({
        name: file.name.replace(/\.stl$/i, ''),
        type: 'stl',
        meshData: data,
        meshFormat: 'stl',
      });
    },
    [addObject],
  );

  const add3MFFile = useCallback(
    async (file: File): Promise<string> => {
      const data = await file.arrayBuffer();
      const colorGroupsRaw = extractColorGroups(data);
      const colorGroups =
        colorGroupsRaw.length > 0
          ? colorGroupsRaw.map((g) => ({ color: g.colorHex }))
          : undefined;
      return addObject({
        name: file.name.replace(/\.3mf$/i, ''),
        type: '3mf',
        meshData: data,
        meshFormat: '3mf',
        colorGroups,
      });
    },
    [addObject],
  );

  const removeObject = useCallback(
    (id: string) => {
      pushUndo();
      setObjects((prev) => prev.filter((o) => o.id !== id));
      setSelectedObjectId((prev) => (prev === id ? null : prev));
    },
    [pushUndo],
  );

  const duplicateObject = useCallback(
    (id: string): string | null => {
      const source = objects.find((o) => o.id === id);
      if (!source) return null;
      pushUndo();
      const copy = cloneObject(source);
      setObjects((prev) => [...prev, copy]);
      setSelectedObjectId(copy.id);
      return copy.id;
    },
    [objects, pushUndo],
  );

  const updateObjectTransform = useCallback(
    (
      id: string,
      transform: Partial<{
        position: { x: number; y: number };
        rotation: number;
        scale: { x: number; y: number; z: number };
      }>,
    ) => {
      pushUndo();
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          return {
            ...o,
            ...(transform.position !== undefined && { position: transform.position }),
            ...(transform.rotation !== undefined && { rotation: transform.rotation }),
            ...(transform.scale !== undefined && { scale: transform.scale }),
          };
        }),
      );
    },
    [pushUndo],
  );

  const updateObjectOverrides = useCallback(
    (id: string, overrides: Partial<PrintProfile>) => {
      pushUndo();
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          return {
            ...o,
            printOverrides: { ...o.printOverrides, ...overrides },
          };
        }),
      );
    },
    [pushUndo],
  );

  const clearObjectOverrides = useCallback((id: string) => {
    pushUndo();
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        return { ...o, printOverrides: undefined };
      }),
    );
  }, [pushUndo]);

  const setExtruderAssignment = useCallback((id: string, extruder: number) => {
    pushUndo();
    setObjects((prev) =>
      prev.map((o) => {
        if (o.id !== id) return o;
        return { ...o, extruderAssignment: extruder };
      }),
    );
  }, [pushUndo]);

  const replaceObjectMesh = useCallback(
    (
      id: string,
      meshData: ArrayBuffer,
      meshFormat: MeshFormat,
      colorGroups?: Array<{ color: string; name?: string }>,
      scadParams?: Record<string, ScadValue>,
    ) => {
      pushUndo();
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          return {
            ...o,
            meshData,
            meshFormat,
            ...(colorGroups !== undefined && { colorGroups }),
            ...(scadParams !== undefined && { scadParams }),
          };
        }),
      );
    },
    [pushUndo],
  );

  // ── Mirror & array copy ─────────────────────────────────────────────

  const mirrorObject = useCallback(
    (id: string, axis: 'x' | 'y' | 'z') => {
      pushUndo();
      setObjects((prev) =>
        prev.map((o) => {
          if (o.id !== id) return o;
          return {
            ...o,
            scale: {
              ...o.scale,
              [axis]: -o.scale[axis],
            },
          };
        }),
      );
    },
    [pushUndo],
  );

  const arrayCopyObject = useCallback(
    (
      id: string,
      rows: number,
      cols: number,
      spacingX: number,
      spacingY: number,
    ): string[] => {
      const source = objects.find((o) => o.id === id);
      if (!source) return [];
      pushUndo();
      const newIds: string[] = [];
      const copies: BuildPlateObject[] = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          // Skip the first position (0,0) — that's the original object
          if (row === 0 && col === 0) continue;
          const copy = cloneObject(source, 0);
          copy.name = `${source.name} (${row + 1},${col + 1})`;
          copy.position = {
            x: source.position.x + col * spacingX,
            y: source.position.y + row * spacingY,
          };
          copies.push(copy);
          newIds.push(copy.id);
        }
      }
      if (copies.length > 0) {
        setObjects((prev) => [...prev, ...copies]);
      }
      return newIds;
    },
    [objects, pushUndo],
  );

  // ── Plate operations ────────────────────────────────────────────────

  const setPlateProfile = useCallback((updates: Partial<PrintProfile>) => {
    setPlateProfileState((prev) => ({ ...prev, ...updates }));
  }, []);

  const setPrimeTower = useCallback((updates: Partial<PrimeTowerConfig>) => {
    setPrimeTowerState((prev) => ({ ...prev, ...updates }));
    // Sync prime tower enabled state to the plate profile so the slicer sees it
    if (updates.enabled !== undefined) {
      setPlateProfileState((prev) => ({ ...prev, enablePrimeTower: updates.enabled! }));
    }
  }, []);

  const setFlushVolumeConfig = useCallback((config: FlushVolumeConfig | undefined) => {
    setFlushVolumeConfigState(config);
  }, []);

  const setPrintSequence = useCallback((mode: PrintSequence) => {
    setPrintSequenceState(mode);
  }, []);

  const autoArrange = useCallback(() => {
    pushUndo();
    setObjects((prev) => {
      const arranged = autoArrangeObjects(prev, bedWidth, bedDepth, originCenter);
      return prev.map((obj, i) => ({
        ...obj,
        position: arranged[i].position,
      }));
    });
  }, [bedWidth, bedDepth, originCenter, pushUndo]);

  const clearPlate = useCallback(() => {
    pushUndo();
    setObjects([]);
    setSelectedObjectId(null);
  }, [pushUndo]);

  // ── Selection ───────────────────────────────────────────────────────

  const selectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedObjectId(null);
  }, []);

  return {
    objects,
    selectedObjectId,
    selectedObject,
    plateProfile,
    primeTower,
    flushVolumeConfig,
    printSequence,
    loaded,

    addSTLFile,
    add3MFFile,
    addObject,
    removeObject,
    duplicateObject,
    updateObjectTransform,
    updateObjectOverrides,
    clearObjectOverrides,
    setExtruderAssignment,
    replaceObjectMesh,

    mirrorObject,
    arrayCopyObject,

    setPlateProfile,
    setPrimeTower,
    setFlushVolumeConfig,
    setPrintSequence,
    autoArrange,
    clearPlate,

    selectObject,
    deselectAll,

    undo,
    redo,
    canUndo,
    canRedo,
  };
}
