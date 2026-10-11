/**
 * Storage interface for audit_log digests and archived partitions.
 *
 * Production deployments back this with write-once (WORM) object storage
 * (for example S3 Object Lock in compliance mode or GCS Bucket Lock); that
 * bucket, its retention period and the credentials are consumer operations
 * and are not created or touched by the generator. `LocalDirectoryStorage`
 * is the implementation used by tests and local runs.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AuditLogStorage {
  /**
   * Store `body` under `key`. Writing the same body to an existing key is a
   * no-op (so a retried job is idempotent); writing a different body to an
   * existing key must throw, as a WORM store would refuse it.
   */
  put(key: string, body: string): Promise<void>;
  /** Return the stored body, or `null` when the key does not exist. */
  get(key: string): Promise<string | null>;
}

export class LocalDirectoryStorage implements AuditLogStorage {
  constructor(private readonly rootDir: string) {}

  private resolve(key: string): string {
    const full = path.resolve(this.rootDir, key);
    if (full !== this.rootDir && !full.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Storage key escapes the storage directory: ${key}`);
    }
    return full;
  }

  async put(key: string, body: string): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(file, body, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const existing = await fs.readFile(file, 'utf8');
      if (existing !== body) {
        throw new Error(`Refusing to overwrite ${key}: stored content differs (write-once storage)`);
      }
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await fs.readFile(this.resolve(key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
}
