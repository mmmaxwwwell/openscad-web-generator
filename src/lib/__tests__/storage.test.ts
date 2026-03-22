// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { createStorage } from '../storage';

// Mock the dynamic import
vi.mock('../storage-browser', () => ({
  BrowserStorageAdapter: class MockBrowserAdapter {
    type = 'browser';
    async listFiles() { return []; }
    async loadFile() { return ''; }
    async saveFile() {}
    async deleteFile() {}
  },
}));

describe('createStorage', () => {
  it('creates a browser storage adapter', async () => {
    const adapter = await createStorage();
    expect((adapter as any).type).toBe('browser');
  });

  it('adapter implements StorageAdapter interface', async () => {
    const adapter = await createStorage();
    expect(typeof adapter.listFiles).toBe('function');
    expect(typeof adapter.loadFile).toBe('function');
    expect(typeof adapter.saveFile).toBe('function');
    expect(typeof adapter.deleteFile).toBe('function');
  });
});
