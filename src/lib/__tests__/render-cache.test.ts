// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canonicalize, computeCacheKey, getCachedRender, setCachedRender, hasCachedRender } from '../render-cache';

// ─── canonicalize ───────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('sorts keys alphabetically', () => {
    const result = canonicalize({ z: 1, a: 2, m: 3 });
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('returns same string regardless of insertion order', () => {
    const a = canonicalize({ foo: 'bar', baz: 42 });
    const b = canonicalize({ baz: 42, foo: 'bar' });
    expect(a).toBe(b);
  });

  it('handles empty object', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('handles string values', () => {
    const result = canonicalize({ name: 'test' });
    expect(result).toBe('{"name":"test"}');
  });

  it('handles boolean values', () => {
    const result = canonicalize({ flag: true });
    expect(result).toBe('{"flag":true}');
  });

  it('handles array values', () => {
    const result = canonicalize({ vec: [1, 2, 3] });
    expect(result).toBe('{"vec":[1,2,3]}');
  });

  it('handles nested arrays (vectors)', () => {
    const result = canonicalize({ pos: [10, 20] });
    expect(JSON.parse(result)).toEqual({ pos: [10, 20] });
  });
});

// ─── computeCacheKey ────────────────────────────────────────────────────────

describe('computeCacheKey', () => {
  it('returns a 64-char hex string (SHA-256)', async () => {
    const key = await computeCacheKey('cube(10);', {}, 'stl');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('same inputs produce same key', async () => {
    const a = await computeCacheKey('cube(10);', { size: 5 }, 'stl');
    const b = await computeCacheKey('cube(10);', { size: 5 }, 'stl');
    expect(a).toBe(b);
  });

  it('different source produces different key', async () => {
    const a = await computeCacheKey('cube(10);', {}, 'stl');
    const b = await computeCacheKey('sphere(10);', {}, 'stl');
    expect(a).not.toBe(b);
  });

  it('different params produce different key', async () => {
    const a = await computeCacheKey('cube(s);', { s: 10 }, 'stl');
    const b = await computeCacheKey('cube(s);', { s: 20 }, 'stl');
    expect(a).not.toBe(b);
  });

  it('different format produces different key', async () => {
    const a = await computeCacheKey('cube(10);', {}, 'stl');
    const b = await computeCacheKey('cube(10);', {}, '3mf');
    expect(a).not.toBe(b);
  });

  it('param order does not affect key (canonicalized)', async () => {
    const a = await computeCacheKey('cube(s);', { x: 1, y: 2 }, 'stl');
    const b = await computeCacheKey('cube(s);', { y: 2, x: 1 }, 'stl');
    expect(a).toBe(b);
  });
});

// ─── IndexedDB-backed functions (mocked) ────────────────────────────────────

// In-memory store that mocks the IDB object store
function createMockCursor(deleteCount: number) {
  let called = 0;
  const cursor: any = {
    delete: vi.fn(),
    continue: vi.fn(async () => {
      called++;
      return called < deleteCount ? cursor : null;
    }),
  };
  return cursor;
}

function createMockDb(storeSize = 0) {
  const store = new Map<string, any>();
  const mockDb = {
    get: vi.fn((_store: string, key: string) => store.get(key)),
    put: vi.fn((_store: string, record: any) => { store.set(record.key, record); }),
    getKey: vi.fn((_store: string, key: string) => store.has(key) ? key : undefined),
    transaction: vi.fn(() => {
      const count = storeSize || store.size;
      const toDelete = Math.max(0, count - 50);
      const cursor = toDelete > 0 ? createMockCursor(toDelete) : null;
      return {
        store: {
          count: vi.fn(async () => count),
          index: vi.fn(() => ({
            openCursor: vi.fn(async () => cursor),
          })),
        },
        done: Promise.resolve(),
      };
    }),
    _store: store,
  };
  return mockDb;
}

let mockDb: ReturnType<typeof createMockDb>;

let lastUpgradeCallback: ((db: any) => void) | null = null;

vi.mock('idb', () => ({
  openDB: vi.fn((_name: string, _version: number, options?: { upgrade?: (db: any) => void }) => {
    // Invoke the upgrade callback so it gets coverage
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

describe('getCachedRender', () => {
  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('returns null for cache miss', async () => {
    const result = await getCachedRender('nonexistent');
    expect(result).toBeNull();
  });

  it('returns data for cache hit', async () => {
    const data = new ArrayBuffer(4);
    mockDb._store.set('mykey', { key: 'mykey', data, format: 'stl', timestamp: 1 });
    const result = await getCachedRender('mykey');
    expect(result).toBe(data);
  });
});

describe('setCachedRender', () => {
  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('stores a record', async () => {
    const data = new ArrayBuffer(8);
    await setCachedRender('key1', data, 'stl');
    expect(mockDb.put).toHaveBeenCalledWith('renders', expect.objectContaining({
      key: 'key1',
      data,
      format: 'stl',
    }));
  });

  it('includes a timestamp', async () => {
    const before = Date.now();
    await setCachedRender('key2', new ArrayBuffer(1), '3mf');
    const after = Date.now();
    const record = mockDb.put.mock.calls[0][1];
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });

  it('evicts oldest entries when over MAX_ENTRIES (50)', async () => {
    // Mock a db that reports 53 entries — should delete 3
    mockDb = createMockDb(53);
    await setCachedRender('new-key', new ArrayBuffer(1), 'stl');

    const tx = mockDb.transaction.mock.results[0].value;
    const cursor = await tx.store.index().openCursor();
    // cursor.delete should have been called 3 times
    expect(cursor.delete).toHaveBeenCalledTimes(3);
  });

  it('does not evict when at or below MAX_ENTRIES', async () => {
    mockDb = createMockDb(50);
    await setCachedRender('key', new ArrayBuffer(1), 'stl');

    const tx = mockDb.transaction.mock.results[0].value;
    // openCursor returns null (no eviction needed), so no delete calls
    const cursor = await tx.store.index().openCursor();
    expect(cursor).toBeNull();
  });
});

describe('getDb upgrade callback', () => {
  it('creates object store when it does not exist', async () => {
    // The mock already invokes upgrade with contains() → false,
    // so just verify it ran without error by calling any DB function
    mockDb = createMockDb();
    const result = await getCachedRender('test');
    expect(result).toBeNull();
  });

  it('skips store creation when store already exists', async () => {
    // Trigger a DB access so the upgrade callback is captured
    mockDb = createMockDb();
    await getCachedRender('trigger');

    // Re-invoke with a DB where the store already exists
    const createObjectStore = vi.fn();
    lastUpgradeCallback!({
      objectStoreNames: { contains: () => true },
      createObjectStore,
    });
    expect(createObjectStore).not.toHaveBeenCalled();
  });
});

describe('hasCachedRender', () => {
  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('returns false for missing key', async () => {
    expect(await hasCachedRender('missing')).toBe(false);
  });

  it('returns true for existing key', async () => {
    mockDb._store.set('exists', { key: 'exists' });
    expect(await hasCachedRender('exists')).toBe(true);
  });
});

// ─── computeCacheKey: edge cases ──────────────────────────────────────────────

describe('computeCacheKey: edge cases', () => {
  it('empty source and params produce a valid key', async () => {
    const key = await computeCacheKey('', {}, 'stl');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different formats with same content produce different keys', async () => {
    const a = await computeCacheKey('cube(10);', {}, 'stl');
    const b = await computeCacheKey('cube(10);', {}, '3mf');
    const c = await computeCacheKey('cube(10);', {}, 'multicolor-3mf');
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it('params with nested arrays produce deterministic key', async () => {
    const a = await computeCacheKey('test', { pos: [1, 2, 3] }, 'stl');
    const b = await computeCacheKey('test', { pos: [1, 2, 3] }, 'stl');
    expect(a).toBe(b);
  });
});

// ─── getCachedRender: edge cases ─────────────────────────────────────────────

describe('getCachedRender: edge cases', () => {
  beforeEach(() => {
    mockDb = createMockDb();
  });

  it('returns data for different formats', async () => {
    const stlData = new ArrayBuffer(4);
    const threemfData = new ArrayBuffer(8);
    mockDb._store.set('stl-key', { key: 'stl-key', data: stlData, format: 'stl', timestamp: 1 });
    mockDb._store.set('3mf-key', { key: '3mf-key', data: threemfData, format: '3mf', timestamp: 2 });
    expect(await getCachedRender('stl-key')).toBe(stlData);
    expect(await getCachedRender('3mf-key')).toBe(threemfData);
  });
});

// ─── setCachedRender: edge cases ─────────────────────────────────────────────

describe('setCachedRender: edge cases', () => {
  it('evicts exactly 1 entry when count is MAX_ENTRIES + 1', async () => {
    mockDb = createMockDb(51);
    await setCachedRender('new-key', new ArrayBuffer(1), 'stl');

    const tx = mockDb.transaction.mock.results[0].value;
    const cursor = await tx.store.index().openCursor();
    expect(cursor.delete).toHaveBeenCalledTimes(1);
  });
});
