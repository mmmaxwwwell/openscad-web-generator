// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { createStorage, type StorageConfig } from '../storage';

// Mock the dynamic imports
vi.mock('../storage-browser', () => ({
  BrowserStorageAdapter: class MockBrowserAdapter {
    type = 'browser';
    async listFiles() { return []; }
    async loadFile() { return ''; }
    async saveFile() {}
    async deleteFile() {}
  },
}));

vi.mock('../storage-s3', () => ({
  S3StorageAdapter: class MockS3Adapter {
    type = 's3';
    config: any;
    constructor(config: any) { this.config = config; }
    async listFiles() { return []; }
    async loadFile() { return ''; }
    async saveFile() {}
    async deleteFile() {}
  },
}));

describe('createStorage', () => {
  it('creates a browser storage adapter for backend: "browser"', async () => {
    const config: StorageConfig = { backend: 'browser' };
    const adapter = await createStorage(config);
    expect((adapter as any).type).toBe('browser');
  });

  it('creates an S3 storage adapter for backend: "s3"', async () => {
    const config: StorageConfig = {
      backend: 's3',
      s3: {
        endpoint: 'https://s3.example.com',
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
    };
    const adapter = await createStorage(config);
    expect((adapter as any).type).toBe('s3');
    expect((adapter as any).config).toEqual(config.s3);
  });

  it('browser adapter implements StorageAdapter interface', async () => {
    const adapter = await createStorage({ backend: 'browser' });
    expect(typeof adapter.listFiles).toBe('function');
    expect(typeof adapter.loadFile).toBe('function');
    expect(typeof adapter.saveFile).toBe('function');
    expect(typeof adapter.deleteFile).toBe('function');
  });

  it('s3 adapter implements StorageAdapter interface', async () => {
    const adapter = await createStorage({
      backend: 's3',
      s3: { endpoint: '', bucket: '', region: '', accessKeyId: '', secretAccessKey: '' },
    });
    expect(typeof adapter.listFiles).toBe('function');
    expect(typeof adapter.loadFile).toBe('function');
    expect(typeof adapter.saveFile).toBe('function');
    expect(typeof adapter.deleteFile).toBe('function');
  });
});
