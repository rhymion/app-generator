import { describe, expect, it } from 'vitest';
import { MAX_S3_RETENTION_DAYS, S3ObjectLockStorage, createS3ObjectLockStorageFromEnv, type S3ObjectLockClient } from './storage-s3';

function fakeClient() {
  const objects = new Map<string, string>();
  const puts: Parameters<S3ObjectLockClient['putObject']>[0][] = [];
  const client: S3ObjectLockClient = {
    async putObject(params) {
      puts.push(params);
      objects.set(params.Key, params.Body);
    },
    async getObject({ Key }) {
      return objects.get(Key) ?? null;
    },
  };
  return { client, puts };
}

describe('S3ObjectLockStorage', () => {
  const now = () => new Date('2026-03-01T00:00:00Z');

  it('writes a new object with a retention date and refuses a different body', async () => {
    const { client, puts } = fakeClient();
    const s = new S3ObjectLockStorage(client, 'bucket', 30, now);
    await s.put('a.json', '{"x":1}');
    expect(puts).toHaveLength(1);
    expect(puts[0].ObjectLockMode).toBe('COMPLIANCE');
    expect(puts[0].ObjectLockRetainUntilDate.toISOString()).toBe('2026-03-31T00:00:00.000Z');
    expect(puts[0].IfNoneMatch).toBe('*');
    await s.put('a.json', '{"x":1}');
    expect(puts).toHaveLength(1);
    await expect(s.put('a.json', '{"x":2}')).rejects.toThrow(/Refusing to overwrite/);
  });

  it('never sets an ACL on the stored object, so the bucket stays private', async () => {
    const { client, puts } = fakeClient();
    await new S3ObjectLockStorage(client, 'bucket', 30, now).put('a.json', '{"x":1}');
    expect(puts).toHaveLength(1);
    for (const name of ['ACL', 'GrantRead', 'GrantReadACP', 'GrantWriteACP', 'GrantFullControl']) {
      expect(puts[0]).not.toHaveProperty(name);
    }
    expect(JSON.stringify(puts[0])).not.toMatch(/public-read|authenticated-read|AllUsers/i);
  });

  it('passes ExpectedBucketOwner on put and get only when configured', async () => {
    const calls: unknown[] = [];
    const client: S3ObjectLockClient = {
      async putObject(params) { calls.push(params); },
      async getObject(params) { calls.push(params); return null; },
    };
    await new S3ObjectLockStorage(client, 'bucket', 30, now, '123456789012').put('a.json', '{}');
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toMatchObject({ ExpectedBucketOwner: '123456789012' });
    calls.length = 0;
    await new S3ObjectLockStorage(client, 'bucket', 30, now).put('a.json', '{}');
    for (const c of calls) expect(c).not.toHaveProperty('ExpectedBucketOwner');
  });

  it('returns null for a missing key and rejects a non-positive retention', async () => {
    const { client } = fakeClient();
    expect(await new S3ObjectLockStorage(client, 'bucket', 30).get('missing')).toBeNull();
    expect(() => new S3ObjectLockStorage(client, 'bucket', 0)).toThrow(/whole number of days/);
  });

  it('rejects a retention above the maximum, and accepts the maximum itself', async () => {
    const { client } = fakeClient();
    expect(() => new S3ObjectLockStorage(client, 'bucket', MAX_S3_RETENTION_DAYS)).not.toThrow();
    expect(() => new S3ObjectLockStorage(client, 'bucket', MAX_S3_RETENTION_DAYS + 1)).toThrow(/above the maximum/);
    await expect(createS3ObjectLockStorageFromEnv({
      AUDIT_LOG_S3_BUCKET: 'b', AUDIT_LOG_S3_REGION: 'us-east-1', AUDIT_LOG_S3_RETENTION_DAYS: '36500',
    })).rejects.toThrow(/above the maximum/);
  });

  it('rejects a malformed AUDIT_LOG_S3_EXPECTED_BUCKET_OWNER', async () => {
    await expect(createS3ObjectLockStorageFromEnv({
      AUDIT_LOG_S3_BUCKET: 'b', AUDIT_LOG_S3_REGION: 'us-east-1', AUDIT_LOG_S3_RETENTION_DAYS: '30',
      AUDIT_LOG_S3_EXPECTED_BUCKET_OWNER: 'not-an-id',
    })).rejects.toThrow(/12-digit/);
  });
});
