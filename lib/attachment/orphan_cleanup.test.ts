// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { attachment: { findMany: db.findMany, deleteMany: db.deleteMany } } }));
const storage = vi.hoisted(() => ({ deleteStoredObject: vi.fn() }));
vi.mock('@/lib/attachment/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/attachment/storage')>()),
  deleteStoredObject: storage.deleteStoredObject,
}));

import { ORPHAN_MAX_AGE_HOURS, deleteOrphanAttachments } from './orphan_cleanup';

const UNLINKED = { attachable_id: null, user_image: null } as const;
const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-25T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  storage.deleteStoredObject.mockResolvedValue(undefined);
  db.deleteMany.mockResolvedValue({ count: 1 });
});

describe('deleteOrphanAttachments', () => {
  it('selects only unlinked rows older than 24 hours', async () => {
    db.findMany.mockResolvedValue([]);
    await deleteOrphanAttachments(UNLINKED, { now: NOW });
    const where = db.findMany.mock.calls[0][0].where;
    expect(ORPHAN_MAX_AGE_HOURS).toBe(24);
    expect(where).toMatchObject(UNLINKED);
    expect(where.created_at.lt).toEqual(new Date('2026-10-24T12:00:00Z'));
  });

  it('deletes each row and its stored object', async () => {
    db.findMany.mockResolvedValueOnce([{ id: 'a', path: KEY_A }, { id: 'b', path: KEY_B }]);
    const result = await deleteOrphanAttachments(UNLINKED, { now: NOW });
    expect(result).toEqual({ deleted: 2, objectsNotRemoved: [] });
    expect(db.deleteMany).toHaveBeenCalledWith({ where: { id: 'a', ...UNLINKED } });
    expect(storage.deleteStoredObject.mock.calls.map((c) => c[0])).toEqual([KEY_A, KEY_B]);
  });

  it('leaves an upload alone that was attached after it was selected', async () => {
    db.findMany.mockResolvedValueOnce([{ id: 'a', path: KEY_A }]);
    db.deleteMany.mockResolvedValue({ count: 0 });
    const result = await deleteOrphanAttachments(UNLINKED, { now: NOW });
    expect(result.deleted).toBe(0);
    expect(storage.deleteStoredObject).not.toHaveBeenCalled();
  });

  it('reports an object that could not be removed, after its row is gone', async () => {
    db.findMany.mockResolvedValueOnce([{ id: 'a', path: KEY_A }]);
    storage.deleteStoredObject.mockRejectedValue(new Error('denied'));
    const result = await deleteOrphanAttachments(UNLINKED, { now: NOW });
    expect(result).toEqual({ deleted: 1, objectsNotRemoved: [KEY_A] });
  });

  it('never passes a value that is not a storage key to the storage backend', async () => {
    db.findMany.mockResolvedValueOnce([{ id: 'a', path: '/legacy/path.pdf' }]);
    await deleteOrphanAttachments(UNLINKED, { now: NOW });
    expect(storage.deleteStoredObject).not.toHaveBeenCalled();
  });
});
