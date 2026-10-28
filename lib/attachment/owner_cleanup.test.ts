// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({ del: vi.fn() }));
vi.mock('@/lib/attachment/storage', () => ({
  deleteStoredObject: storage.del,
  isStorageKey: (k: string) => /^[0-9a-f-]{36}$/.test(k),
}));

import { deleteBridgeAttachments, removeStoredObjects } from './owner_cleanup';

const KEY_A = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';

function client(rows: Array<{ id: string; path: string }>) {
  return {
    attachment: {
      findMany: vi.fn().mockResolvedValue(rows),
      deleteMany: vi.fn().mockResolvedValue({ count: rows.length }),
    },
  };
}

beforeEach(() => storage.del.mockReset());

describe('deleteBridgeAttachments', () => {
  it('deletes the rows linked to the bridge rows and returns their storage keys', async () => {
    const tx = client([
      { id: 'a1', path: KEY_A },
      { id: 'a2', path: KEY_B },
    ]);
    expect(await deleteBridgeAttachments(tx, ['b1', null, 'b2'])).toEqual([KEY_A, KEY_B]);
    expect(tx.attachment.findMany).toHaveBeenCalledWith({
      where: { attachable_id: { in: ['b1', 'b2'] } },
      select: { id: true, path: true },
    });
    expect(tx.attachment.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['a1', 'a2'] } } });
    // Rows only: the stored files are removed after commit.
    expect(storage.del).not.toHaveBeenCalled();
  });

  it('does nothing without bridge ids or linked rows', async () => {
    const tx = client([]);
    expect(await deleteBridgeAttachments(tx, [null, undefined])).toEqual([]);
    expect(tx.attachment.findMany).not.toHaveBeenCalled();
    expect(await deleteBridgeAttachments(tx, ['b1'])).toEqual([]);
    expect(tx.attachment.deleteMany).not.toHaveBeenCalled();
  });
});

describe('removeStoredObjects', () => {
  it('removes valid keys, skips non-keys, and swallows a failed removal', async () => {
    storage.del.mockRejectedValueOnce(new Error('gone')).mockResolvedValue(undefined);
    await expect(removeStoredObjects([KEY_A, KEY_B, 'not-a-key'])).resolves.toBeUndefined();
    expect(storage.del).toHaveBeenCalledTimes(2);
  });
});
