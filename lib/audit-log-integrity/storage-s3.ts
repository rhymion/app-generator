/**
 * AuditLogStorage on an S3 bucket with Object Lock. Every object is written
 * with a retention date, so the bucket itself refuses overwrite and delete
 * until it passes. The bucket, its Object Lock configuration and the
 * credentials are created by ops; nothing here creates them.
 *
 * `@aws-sdk/client-s3` is loaded by a dynamic import with a literal module
 * name, and only when `createS3ObjectLockStorageFromEnv` runs. The module is
 * therefore part of the build trace, and never loaded by an app that does not
 * select this storage. Tests inject a client instead.
 */
import type { AuditLogStorage } from './storage';

export type S3ObjectLockClient = {
  putObject(params: {
    Bucket: string;
    Key: string;
    Body: string;
    ContentType: string;
    ObjectLockMode: 'COMPLIANCE';
    ObjectLockRetainUntilDate: Date;
    IfNoneMatch: '*';
    ExpectedBucketOwner?: string;
  }): Promise<void>;
  /** Returns the object body, or null when the key does not exist. */
  getObject(params: { Bucket: string; Key: string; ExpectedBucketOwner?: string }): Promise<string | null>;
};

/**
 * Upper bound on the retention period, in days (10 years). Object Lock COMPLIANCE retention cannot be
 * shortened or removed by anyone, including the account root, so a typo such as an extra zero would be an
 * irreversible storage-cost commitment. A larger value is rejected instead of being accepted silently.
 */
export const MAX_S3_RETENTION_DAYS = 3650;

export class S3ObjectLockStorage implements AuditLogStorage {
  constructor(
    private readonly client: S3ObjectLockClient,
    private readonly bucket: string,
    private readonly retentionDays: number,
    private readonly now: () => Date = () => new Date(),
    /** AWS account id that must own the bucket; the request fails when another account owns a same-named bucket. */
    private readonly expectedBucketOwner?: string,
  ) {
    if (!Number.isInteger(retentionDays) || retentionDays < 1) {
      throw new Error(`Retention must be a whole number of days, got: ${retentionDays}`);
    }
    if (retentionDays > MAX_S3_RETENTION_DAYS) {
      throw new Error(
        `Retention of ${retentionDays} days is above the maximum of ${MAX_S3_RETENTION_DAYS} days. ` +
          'S3 Object Lock COMPLIANCE retention cannot be shortened or removed by anyone, including the account root; ' +
          'check AUDIT_LOG_S3_RETENTION_DAYS for a typo.',
      );
    }
  }

  async put(key: string, body: string): Promise<void> {
    const existing = await this.get(key);
    if (existing !== null) {
      if (existing === body) return;
      throw new Error(`Refusing to overwrite ${key}: stored content differs (write-once storage)`);
    }
    const retainUntil = new Date(this.now().getTime() + this.retentionDays * 24 * 60 * 60 * 1000);
    await this.client.putObject({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: retainUntil,
      IfNoneMatch: '*',
      ...this.ownerParam(),
    });
  }

  get(key: string): Promise<string | null> {
    return this.client.getObject({ Bucket: this.bucket, Key: key, ...this.ownerParam() });
  }

  private ownerParam(): { ExpectedBucketOwner?: string } {
    return this.expectedBucketOwner ? { ExpectedBucketOwner: this.expectedBucketOwner } : {};
  }
}

export async function createS3ObjectLockStorageFromEnv(env: Record<string, string | undefined> = process.env): Promise<AuditLogStorage> {
  const bucket = env.AUDIT_LOG_S3_BUCKET;
  const region = env.AUDIT_LOG_S3_REGION;
  const retentionDays = Number(env.AUDIT_LOG_S3_RETENTION_DAYS);
  if (!bucket || !region || !env.AUDIT_LOG_S3_RETENTION_DAYS) {
    throw new Error('AUDIT_LOG_S3_BUCKET, AUDIT_LOG_S3_REGION and AUDIT_LOG_S3_RETENTION_DAYS are all required.');
  }
  const owner = env.AUDIT_LOG_S3_EXPECTED_BUCKET_OWNER || undefined;
  if (owner !== undefined && !/^\d{12}$/.test(owner)) {
    throw new Error('AUDIT_LOG_S3_EXPECTED_BUCKET_OWNER must be a 12-digit AWS account id.');
  }
  const sdk = await import('@aws-sdk/client-s3');
  const s3 = new sdk.S3Client({ region });
  const client: S3ObjectLockClient = {
    async putObject(params) {
      await s3.send(new sdk.PutObjectCommand(params));
    },
    async getObject(params) {
      try {
        const res = await s3.send(new sdk.GetObjectCommand(params));
        return (await res.Body?.transformToString('utf-8')) ?? '';
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
  };
  return new S3ObjectLockStorage(client, bucket, retentionDays, undefined, owner);
}
