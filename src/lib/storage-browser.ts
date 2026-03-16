// SPDX-License-Identifier: AGPL-3.0-or-later
import { openDB, type IDBPDatabase } from 'idb';
import type { StorageAdapter, FileInfo, ScadValue } from '../types';

const DB_NAME = 'openscad-web-app';
const DB_VERSION = 1;
const FILES_STORE = 'scad-files';
const PARAM_SETS_STORE = 'parameter-sets';

interface ScadFileRecord {
  id: string;
  name: string;
  content: string;
  lastModified: Date;
}

interface ParamSetRecord {
  key: string;         // "{fileId}:{setName}"
  fileId: string;
  name: string;
  values: Record<string, ScadValue>;
}

function getDb(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PARAM_SETS_STORE)) {
        const store = db.createObjectStore(PARAM_SETS_STORE, { keyPath: 'key' });
        store.createIndex('byFileId', 'fileId', { unique: false });
      }
    },
  });
}

// ─── File Storage ────────────────────────────────────────

export class BrowserStorageAdapter implements StorageAdapter {
  async listFiles(): Promise<FileInfo[]> {
    const db = await getDb();
    const records: ScadFileRecord[] = await db.getAll(FILES_STORE);
    return records.map((r) => ({
      id: r.id,
      name: r.name,
      lastModified: r.lastModified,
      size: r.content.length,
    }));
  }

  async loadFile(id: string): Promise<string> {
    const db = await getDb();
    const record: ScadFileRecord | undefined = await db.get(FILES_STORE, id);
    if (!record) throw new Error(`File not found: ${id}`);
    return record.content;
  }

  async saveFile(id: string, content: string): Promise<void> {
    const db = await getDb();
    const record: ScadFileRecord = {
      id,
      name: id,
      content,
      lastModified: new Date(),
    };
    await db.put(FILES_STORE, record);
  }

  async deleteFile(id: string): Promise<void> {
    const db = await getDb();
    await db.delete(FILES_STORE, id);
    // Also delete all parameter sets for this file
    const tx = db.transaction(PARAM_SETS_STORE, 'readwrite');
    const index = tx.store.index('byFileId');
    let cursor = await index.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}

// ─── Parameter Set Storage ───────────────────────────────

export class BrowserParamSetStorage {
  private makeKey(fileId: string, setName: string): string {
    return `${fileId}:${setName}`;
  }

  async listSets(fileId: string): Promise<{ name: string; values: Record<string, ScadValue> }[]> {
    const db = await getDb();
    const tx = db.transaction(PARAM_SETS_STORE, 'readonly');
    const index = tx.store.index('byFileId');
    const records: ParamSetRecord[] = await index.getAll(IDBKeyRange.only(fileId));
    await tx.done;
    return records.map((r) => ({ name: r.name, values: r.values }));
  }

  async saveSet(fileId: string, name: string, values: Record<string, ScadValue>): Promise<void> {
    const db = await getDb();
    const record: ParamSetRecord = {
      key: this.makeKey(fileId, name),
      fileId,
      name,
      values,
    };
    await db.put(PARAM_SETS_STORE, record);
  }

  async deleteSet(fileId: string, name: string): Promise<void> {
    const db = await getDb();
    await db.delete(PARAM_SETS_STORE, this.makeKey(fileId, name));
  }
}
