import type { StorageAdapter } from '../types';

export type StorageBackend = 'browser' | 's3';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export type StorageConfig =
  | { backend: 'browser' }
  | { backend: 's3'; s3: S3Config };

/**
 * Create a storage adapter based on the given configuration.
 * Dynamically imports the appropriate adapter module.
 */
export async function createStorage(config: StorageConfig): Promise<StorageAdapter> {
  if (config.backend === 's3') {
    const { S3StorageAdapter } = await import('./storage-s3');
    return new S3StorageAdapter(config.s3);
  }
  const { BrowserStorageAdapter } = await import('./storage-browser');
  return new BrowserStorageAdapter();
}
