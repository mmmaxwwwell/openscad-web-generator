import { openDB, type IDBPDatabase } from 'idb';
import type { ScadValue } from '../types';

const DB_NAME = 'openscad-render-cache';
const DB_VERSION = 1;
const STORE = 'renders';
const MAX_ENTRIES = 50;

type ExportType = 'stl' | '3mf' | 'multicolor-3mf';

interface CacheRecord {
  key: string;
  data: ArrayBuffer;
  format: ExportType;
  timestamp: number;
}

function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('byTimestamp', 'timestamp', { unique: false });
      }
    },
  });
}

function canonicalize(obj: Record<string, ScadValue>): string {
  const sorted: Record<string, ScadValue> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return JSON.stringify(sorted);
}

export async function computeCacheKey(
  source: string,
  params: Record<string, ScadValue>,
  format: ExportType,
): Promise<string> {
  const payload = JSON.stringify({ source, params: canonicalize(params), format });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getCachedRender(key: string): Promise<ArrayBuffer | null> {
  const db = await getDb();
  const record: CacheRecord | undefined = await db.get(STORE, key);
  return record?.data ?? null;
}

export async function setCachedRender(
  key: string,
  data: ArrayBuffer,
  format: ExportType,
): Promise<void> {
  const db = await getDb();
  const record: CacheRecord = { key, data, format, timestamp: Date.now() };
  await db.put(STORE, record);

  // Evict old entries if over limit
  const tx = db.transaction(STORE, 'readwrite');
  const index = tx.store.index('byTimestamp');
  const count = await tx.store.count();
  if (count > MAX_ENTRIES) {
    const toDelete = count - MAX_ENTRIES;
    let cursor = await index.openCursor();
    let deleted = 0;
    while (cursor && deleted < toDelete) {
      await cursor.delete();
      deleted++;
      cursor = await cursor.continue();
    }
  }
  await tx.done;
}

export async function hasCachedRender(key: string): Promise<boolean> {
  const db = await getDb();
  const record = await db.getKey(STORE, key);
  return record !== undefined;
}
