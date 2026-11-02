import { describe, expect, it } from 'vitest';
import {
  GcsObjectRetentionStorage,
  GcsPreconditionFailedError,
  gcsClientFromStorage,
  type GcsObjectRetentionClient,
} from './storage-gcs';

type Create = Parameters<GcsObjectRetentionClient['createIfAbsent']>[0];

function fakeClient(options: { loseRaceWith?: string } = {}) {
  const objects = new Map<string, string>();
  const creates: Create[] = [];
  const client: GcsObjectRetentionClient = {
    async createIfAbsent(params) {
      creates.push(params);
      if (options.loseRaceWith !== undefined) {
        objects.set(params.key, options.loseRaceWith);
        throw new GcsPreconditionFailedError(params.key);
      }
      if (objects.has(params.key)) throw new GcsPreconditionFailedError(params.key);
      objects.set(params.key, params.body);
    },
    async getObject({ key }) {
      return objects.get(key) ?? null;
    },
  };
  return { client, creates };
}

describe('GcsObjectRetentionStorage', () => {
  const now = () => new Date('2026-03-01T00:00:00Z');

  it('creates a new object with retention and a bucket-scoped key', async () => {
    const { client, creates } = fakeClient();
    await new GcsObjectRetentionStorage(client, 'bucket', 30, 'locked', now).put('a.json', '{"x":1}');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({ bucket: 'bucket', key: 'a.json', retentionMode: 'locked' });
    expect(creates[0].retainUntil.toISOString()).toBe('2026-03-31T00:00:00.000Z');
  });

  it('treats a re-put of the same body as a no-op and refuses a different body', async () => {
    const { client, creates } = fakeClient();
    const s = new GcsObjectRetentionStorage(client, 'bucket', 30, 'unlocked', now);
    await s.put('a.json', '{"x":1}');
    await s.put('a.json', '{"x":1}');
    expect(creates).toHaveLength(1);
    await expect(s.put('a.json', '{"x":2}')).rejects.toThrow(/Refusing to overwrite/);
  });

  it('returns null for a missing key', async () => {
    const { client } = fakeClient();
    expect(await new GcsObjectRetentionStorage(client, 'bucket', 30, 'unlocked').get('missing')).toBeNull();
  });

  it('compares the stored body when another writer wins the create race', async () => {
    const same = fakeClient({ loseRaceWith: 'same' });
    await new GcsObjectRetentionStorage(same.client, 'bucket', 30, 'unlocked', now).put('k', 'same');
    const other = fakeClient({ loseRaceWith: 'other' });
    await expect(new GcsObjectRetentionStorage(other.client, 'bucket', 30, 'unlocked', now).put('k', 'mine')).rejects.toThrow(
      /Refusing to overwrite/,
    );
  });

  it('rejects an invalid retention or mode', () => {
    const { client } = fakeClient();
    expect(() => new GcsObjectRetentionStorage(client, 'b', 0, 'locked')).toThrow(/whole number of days/);
    expect(() => new GcsObjectRetentionStorage(client, 'b', 1, 'bogus' as never)).toThrow(/"unlocked" or "locked"/);
  });
});

describe('gcsClientFromStorage', () => {
  function fakeStorage(behaviour: { saveError?: { code: number }; downloadError?: { code: number }; body?: string }) {
    const saves: { key: string; data: string; options: Record<string, unknown> }[] = [];
    const storage = {
      bucket: () => ({
        file: (key: string) => ({
          async save(data: string, options: Record<string, unknown>) {
            saves.push({ key, data, options });
            if (behaviour.saveError) throw Object.assign(new Error('save failed'), behaviour.saveError);
          },
          async download(): Promise<[Buffer]> {
            if (behaviour.downloadError) throw Object.assign(new Error('download failed'), behaviour.downloadError);
            return [Buffer.from(behaviour.body ?? '', 'utf-8')];
          },
        }),
      }),
    };
    return { storage, saves };
  }

  it('sends ifGenerationMatch 0 and the retention metadata on create', async () => {
    const { storage, saves } = fakeStorage({});
    await gcsClientFromStorage(storage).createIfAbsent({
      bucket: 'b',
      key: 'k',
      body: 'x',
      contentType: 'application/json',
      retentionMode: 'unlocked',
      retainUntil: new Date('2026-03-31T00:00:00Z'),
    });
    expect(saves[0].options.preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    expect(saves[0].options.metadata).toEqual({ retention: { mode: 'Unlocked', retainUntilTime: '2026-03-31T00:00:00.000Z' } });
  });

  it('never asks for a public object: no predefined ACL, no public flag, no allUsers grant', async () => {
    const { storage, saves } = fakeStorage({});
    await gcsClientFromStorage(storage).createIfAbsent({
      bucket: 'b',
      key: 'k',
      body: 'x',
      contentType: 'application/json',
      retentionMode: 'locked',
      retainUntil: new Date('2026-03-31T00:00:00Z'),
    });
    const options = saves[0].options;
    expect(options).not.toHaveProperty('public');
    expect(options).not.toHaveProperty('private');
    expect(options).not.toHaveProperty('predefinedAcl');
    expect(options).not.toHaveProperty('acl');
    expect(JSON.stringify(options)).not.toMatch(/allUsers|allAuthenticatedUsers|publicRead|publicReadWrite/i);
  });

  it('maps 412 to a precondition error and rethrows anything else', async () => {
    const params = {
      bucket: 'b',
      key: 'k',
      body: 'x',
      contentType: 'application/json',
      retentionMode: 'locked' as const,
      retainUntil: new Date(),
    };
    await expect(gcsClientFromStorage(fakeStorage({ saveError: { code: 412 } }).storage).createIfAbsent(params)).rejects.toBeInstanceOf(
      GcsPreconditionFailedError,
    );
    await expect(gcsClientFromStorage(fakeStorage({ saveError: { code: 403 } }).storage).createIfAbsent(params)).rejects.toThrow(
      'save failed',
    );
  });

  it('reads 404 as missing but never reads a permission error as missing', async () => {
    expect(await gcsClientFromStorage(fakeStorage({ downloadError: { code: 404 } }).storage).getObject({ bucket: 'b', key: 'k' })).toBeNull();
    await expect(gcsClientFromStorage(fakeStorage({ downloadError: { code: 403 } }).storage).getObject({ bucket: 'b', key: 'k' })).rejects.toThrow(
      'download failed',
    );
    expect(await gcsClientFromStorage(fakeStorage({ body: 'hello' }).storage).getObject({ bucket: 'b', key: 'k' })).toBe('hello');
  });
});
