import { describe, expect, it } from 'vitest';
import { S3ObjectLockStorage, type S3ObjectLockClient } from './storage-s3';

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

  it('returns null for a missing key and rejects a non-positive retention', async () => {
    const { client } = fakeClient();
    expect(await new S3ObjectLockStorage(client, 'bucket', 30).get('missing')).toBeNull();
    expect(() => new S3ObjectLockStorage(client, 'bucket', 0)).toThrow(/whole number of days/);
  });
});
