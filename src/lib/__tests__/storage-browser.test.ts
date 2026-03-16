// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub IDBKeyRange globally (not available in Node)
vi.stubGlobal('IDBKeyRange', {
  only: (value: any) => ({ _value: value }),
  bound: (lower: any, upper: any) => ({ _lower: lower, _upper: upper }),
});

import { BrowserStorageAdapter, BrowserParamSetStorage } from '../storage-browser';

// ─── IDB mock ────────────────────────────────────────────

function createMockDb() {
  const filesStore = new Map<string, any>();
  const paramSetsStore = new Map<string, any>();

  const db = {
    getAll: vi.fn((_store: string) => {
      return Promise.resolve(Array.from(filesStore.values()));
    }),
    get: vi.fn((_store: string, key: string) => {
      return Promise.resolve(filesStore.get(key));
    }),
    put: vi.fn((store: string, record: any) => {
      if (store === 'scad-files') {
        filesStore.set(record.id, record);
      } else {
        paramSetsStore.set(record.key, record);
      }
      return Promise.resolve();
    }),
    delete: vi.fn((store: string, key: string) => {
      if (store === 'scad-files') {
        filesStore.delete(key);
      } else {
        paramSetsStore.delete(key);
      }
      return Promise.resolve();
    }),
    transaction: vi.fn((_store: string, _mode?: string) => {
      const matchingRecords = Array.from(paramSetsStore.values());
      let cursorIdx = 0;
      const makeCursor = (): any => {
        if (cursorIdx >= matchingRecords.length) return null;
        const record = matchingRecords[cursorIdx];
        return {
          value: record,
          delete: vi.fn(() => {
            paramSetsStore.delete(record.key);
          }),
          continue: vi.fn(() => {
            cursorIdx++;
            return Promise.resolve(cursorIdx < matchingRecords.length ? makeCursor() : null);
          }),
        };
      };

      return {
        store: {
          index: vi.fn(() => ({
            openCursor: vi.fn((_range?: any) => {
              // Filter by fileId if provided
              const filtered = matchingRecords.filter(r => {
                if (_range && typeof _range === 'object' && _range._value) {
                  return r.fileId === _range._value;
                }
                return true;
              });
              cursorIdx = 0;
              if (filtered.length === 0) return Promise.resolve(null);
              // Replace matchingRecords for iteration
              matchingRecords.length = 0;
              matchingRecords.push(...filtered);
              return Promise.resolve(makeCursor());
            }),
            getAll: vi.fn((_range?: any) => {
              const fileId = _range?._value;
              const filtered = Array.from(paramSetsStore.values())
                .filter(r => !fileId || r.fileId === fileId);
              return Promise.resolve(filtered);
            }),
          })),
        },
        done: Promise.resolve(),
      };
    }),
    _filesStore: filesStore,
    _paramSetsStore: paramSetsStore,
  };
  return db;
}

let mockDb: ReturnType<typeof createMockDb>;

let lastUpgradeCallback: ((db: any) => void) | null = null;

vi.mock('idb', () => ({
  openDB: vi.fn((_name: string, _version: number, options?: { upgrade?: (db: any) => void }) => {
    if (options?.upgrade) {
      lastUpgradeCallback = options.upgrade;
      const fakeDb = {
        objectStoreNames: { contains: () => false },
        createObjectStore: (_name: string, _opts: any) => ({
          createIndex: vi.fn(),
        }),
      };
      options.upgrade(fakeDb);
    }
    return Promise.resolve(mockDb);
  }),
}));

// ─── BrowserStorageAdapter ───────────────────────────────

describe('BrowserStorageAdapter', () => {
  let adapter: BrowserStorageAdapter;

  beforeEach(() => {
    mockDb = createMockDb();
    adapter = new BrowserStorageAdapter();
  });

  describe('listFiles', () => {
    it('returns empty array when no files', async () => {
      const files = await adapter.listFiles();
      expect(files).toEqual([]);
    });

    it('returns file metadata for stored files', async () => {
      const date = new Date('2025-01-01');
      mockDb._filesStore.set('test.scad', {
        id: 'test.scad',
        name: 'test.scad',
        content: 'cube(10);',
        lastModified: date,
      });

      const files = await adapter.listFiles();
      expect(files).toHaveLength(1);
      expect(files[0]).toEqual({
        id: 'test.scad',
        name: 'test.scad',
        lastModified: date,
        size: 9, // 'cube(10);'.length
      });
    });

    it('returns multiple files', async () => {
      mockDb._filesStore.set('a.scad', { id: 'a.scad', name: 'a.scad', content: 'a', lastModified: new Date() });
      mockDb._filesStore.set('b.scad', { id: 'b.scad', name: 'b.scad', content: 'bb', lastModified: new Date() });

      const files = await adapter.listFiles();
      expect(files).toHaveLength(2);
    });
  });

  describe('loadFile', () => {
    it('returns file content for existing file', async () => {
      mockDb._filesStore.set('test.scad', {
        id: 'test.scad',
        name: 'test.scad',
        content: 'sphere(5);',
        lastModified: new Date(),
      });

      const content = await adapter.loadFile('test.scad');
      expect(content).toBe('sphere(5);');
    });

    it('throws for non-existent file', async () => {
      await expect(adapter.loadFile('missing.scad')).rejects.toThrow('File not found: missing.scad');
    });
  });

  describe('saveFile', () => {
    it('stores a new file', async () => {
      await adapter.saveFile('new.scad', 'cylinder(10, 5);');
      expect(mockDb.put).toHaveBeenCalledWith('scad-files', expect.objectContaining({
        id: 'new.scad',
        name: 'new.scad',
        content: 'cylinder(10, 5);',
      }));
    });

    it('overwrites existing file', async () => {
      await adapter.saveFile('test.scad', 'version 1');
      await adapter.saveFile('test.scad', 'version 2');
      expect(mockDb.put).toHaveBeenCalledTimes(2);
      const lastCall = mockDb.put.mock.calls[1];
      expect(lastCall[1].content).toBe('version 2');
    });
  });

  describe('deleteFile', () => {
    it('deletes file from store', async () => {
      mockDb._filesStore.set('test.scad', { id: 'test.scad', name: 'test.scad', content: '', lastModified: new Date() });
      await adapter.deleteFile('test.scad');
      expect(mockDb.delete).toHaveBeenCalledWith('scad-files', 'test.scad');
    });

    it('also deletes associated parameter sets', async () => {
      await adapter.deleteFile('test.scad');
      // Should create a transaction on param-sets store
      expect(mockDb.transaction).toHaveBeenCalledWith('parameter-sets', 'readwrite');
    });

    it('iterates cursor to delete all param sets for the file', async () => {
      // Add param sets associated with the file
      mockDb._paramSetsStore.set('test.scad:Set1', { key: 'test.scad:Set1', fileId: 'test.scad', name: 'Set1', values: {} });
      mockDb._paramSetsStore.set('test.scad:Set2', { key: 'test.scad:Set2', fileId: 'test.scad', name: 'Set2', values: {} });
      mockDb._paramSetsStore.set('other.scad:Set3', { key: 'other.scad:Set3', fileId: 'other.scad', name: 'Set3', values: {} });

      await adapter.deleteFile('test.scad');

      // The file itself should be deleted
      expect(mockDb.delete).toHaveBeenCalledWith('scad-files', 'test.scad');
      // Transaction should be opened for param sets
      expect(mockDb.transaction).toHaveBeenCalledWith('parameter-sets', 'readwrite');
    });
  });
});

// ─── BrowserParamSetStorage ──────────────────────────────

describe('BrowserParamSetStorage', () => {
  let storage: BrowserParamSetStorage;

  beforeEach(() => {
    mockDb = createMockDb();
    storage = new BrowserParamSetStorage();
  });

  describe('saveSet', () => {
    it('saves a parameter set with composite key', async () => {
      await storage.saveSet('file1', 'Default', { width: 10, height: 20 });
      expect(mockDb.put).toHaveBeenCalledWith('parameter-sets', expect.objectContaining({
        key: 'file1:Default',
        fileId: 'file1',
        name: 'Default',
        values: { width: 10, height: 20 },
      }));
    });
  });

  describe('deleteSet', () => {
    it('deletes by composite key', async () => {
      await storage.deleteSet('file1', 'Default');
      expect(mockDb.delete).toHaveBeenCalledWith('parameter-sets', 'file1:Default');
    });
  });

  describe('listSets', () => {
    it('returns empty array when no sets exist', async () => {
      const sets = await storage.listSets('file1');
      expect(sets).toEqual([]);
    });

    it('returns sets for a specific file', async () => {
      mockDb._paramSetsStore.set('file1:A', { key: 'file1:A', fileId: 'file1', name: 'A', values: { x: 1 } });
      mockDb._paramSetsStore.set('file2:B', { key: 'file2:B', fileId: 'file2', name: 'B', values: { x: 2 } });

      const sets = await storage.listSets('file1');
      expect(sets).toHaveLength(1);
      expect(sets[0].name).toBe('A');
      expect(sets[0].values).toEqual({ x: 1 });
    });
  });
});

// ─── IDB upgrade callback branch coverage ────────────────

describe('getDb upgrade callback', () => {
  it('skips store creation when stores already exist', async () => {
    // Trigger any DB access so upgrade callback is captured
    mockDb = createMockDb();
    await new BrowserStorageAdapter().listFiles();

    // Re-invoke the upgrade callback with a DB that already has the stores
    const createObjectStore = vi.fn();
    const fakeDb = {
      objectStoreNames: { contains: () => true },
      createObjectStore,
    };
    lastUpgradeCallback!(fakeDb);
    // createObjectStore should NOT be called since stores already exist
    expect(createObjectStore).not.toHaveBeenCalled();
  });
});
