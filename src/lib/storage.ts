// SPDX-License-Identifier: AGPL-3.0-or-later
import type { StorageAdapter } from '../types';

/**
 * Create a browser storage adapter (IndexedDB).
 */
export async function createStorage(): Promise<StorageAdapter> {
  const { BrowserStorageAdapter } = await import('./storage-browser');
  return new BrowserStorageAdapter();
}
