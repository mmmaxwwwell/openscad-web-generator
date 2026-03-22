// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState, useCallback, useEffect } from 'react';
import type { StorageAdapter, FileInfo } from '../types';
import { createStorage } from '../lib/storage';

interface UseStorageResult {
  adapter: StorageAdapter | null;
  files: FileInfo[];
  loading: boolean;
  error: string | null;
  loadFile: (id: string) => Promise<string>;
  saveFile: (id: string, content: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
}

export function useStorage(): UseStorageResult {
  const [adapter, setAdapter] = useState<StorageAdapter | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize adapter once
  useEffect(() => {
    let cancelled = false;

    async function init() {
      setLoading(true);
      setError(null);
      try {
        const newAdapter = await createStorage();
        if (cancelled) return;
        setAdapter(newAdapter);
        const fileList = await newAdapter.listFiles();
        if (cancelled) return;
        setFiles(fileList);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!adapter) return;
    setLoading(true);
    setError(null);
    try {
      const fileList = await adapter.listFiles();
      setFiles(fileList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  const loadFile = useCallback(async (id: string): Promise<string> => {
    if (!adapter) throw new Error('Storage not initialized');
    return adapter.loadFile(id);
  }, [adapter]);

  const saveFile = useCallback(async (id: string, content: string): Promise<void> => {
    if (!adapter) throw new Error('Storage not initialized');
    await adapter.saveFile(id, content);
    await refresh();
  }, [adapter, refresh]);

  const deleteFile = useCallback(async (id: string): Promise<void> => {
    if (!adapter) throw new Error('Storage not initialized');
    await adapter.deleteFile(id);
    await refresh();
  }, [adapter, refresh]);

  return { adapter, files, loading, error, loadFile, saveFile, deleteFile };
}
