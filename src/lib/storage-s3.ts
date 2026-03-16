// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import type { StorageAdapter, FileInfo } from '../types';
import type { S3Config } from './storage';

const PREFIX = 'scad-files/';

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // needed for most S3-compatible stores (MinIO, etc.)
    });
  }

  async listFiles(): Promise<FileInfo[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: PREFIX,
    });
    const response = await this.client.send(command);
    const files: FileInfo[] = (response.Contents ?? [])
      .filter((obj) => obj.Key && obj.Key !== PREFIX)
      .map((obj) => ({
        id: obj.Key!,
        name: obj.Key!.replace(PREFIX, ''),
        lastModified: obj.LastModified ?? new Date(),
        size: obj.Size,
      }));
    return files;
  }

  async loadFile(id: string): Promise<string> {
    const key = id.startsWith(PREFIX) ? id : PREFIX + id;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.client.send(command);
    return await response.Body!.transformToString('utf-8');
  }

  async saveFile(id: string, content: string): Promise<void> {
    const key = id.startsWith(PREFIX) ? id : PREFIX + id;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
    });
    await this.client.send(command);
  }

  async deleteFile(id: string): Promise<void> {
    const key = id.startsWith(PREFIX) ? id : PREFIX + id;
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }
}
