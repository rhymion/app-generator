import { beforeEach, describe, expect, it } from 'vitest';
import { setAttachmentsForBridge } from '@/lib/attachment/bridge_actions';
import { db, reset } from './fake/prisma';
import { deletedKeys } from './fake/storage';

const byId = (id: string) => db.attachments.find((r) => r.id === id);

beforeEach(() => {
  reset();
  deletedKeys.length = 0;
});

describe('setAttachmentsForBridge ownership', () => {
  it('rejects an id owned by another record of the same organization and changes nothing', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'x1' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('x1')).toMatchObject({ attachable_id: 'attA2' });
    expect(byId('a1')).toBeDefined();
    expect(byId('a2')).toBeDefined();
    expect(deletedKeys).toEqual([]);
  });

  it('rejects an id owned by a record of another organization and changes nothing', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'b1' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('b1')).toMatchObject({ attachable_id: 'attB1' });
    expect(byId('a1')).toBeDefined();
    expect(byId('a2')).toBeDefined();
  });

  it('rejects the whole call when only one of several ids is foreign', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'a1' }, { id: 'b1' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('a1')).toMatchObject({ attachable_id: 'attA1' });
    expect(byId('a2')).toBeDefined();
  });

  it('rejects an id of the same record but another attachment type', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'a3' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('a3')).toMatchObject({ type: 2, attachable_id: 'attA1' });
  });

  it('still refuses a caller who may not edit the attachable', async () => {
    await expect(setAttachmentsForBridge('attB1', 1, [{ id: 'u1' }])).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(byId('u1')).toMatchObject({ attachable_id: null });
  });
});

describe('setAttachmentsForBridge linking an upload', () => {
  it('links an upload the caller made and has not attached yet', async () => {
    await setAttachmentsForBridge('attA1', 1, [{ id: 'a1' }, { id: 'u1' }]);
    expect(byId('u1')).toMatchObject({ attachable_id: 'attA1', type: 1, order: 1 });
  });

  it('rejects an upload another user made, and changes nothing', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'a1' }, { id: 'u2' }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('u2')).toMatchObject({ attachable_id: null, uploader_id: 'user_b' });
    // The call rolled back as a whole: a2 was not listed, but it is still there.
    expect(byId('a2')).toBeDefined();
    expect(deletedKeys).toEqual([]);
  });

  it('rejects an id listed twice', async () => {
    await expect(setAttachmentsForBridge('attA1', 1, [{ id: 'u1' }, { id: 'u1' }])).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(byId('u1')).toMatchObject({ attachable_id: null });
  });

  it('keeps replace semantics and ordering, and removes the stored file of a row that is dropped', async () => {
    await setAttachmentsForBridge('attA1', 1, [{ id: 'a2' }, { id: 'u1' }]);
    const mine = db.attachments.filter((r) => r.attachable_id === 'attA1' && r.type === 1);
    expect(mine.map((r) => [r.id, r.order]).sort()).toEqual([['a2', 0], ['u1', 1]]);
    expect(byId('a1')).toBeUndefined();
    expect(deletedKeys).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(byId('a3')).toBeDefined();
    expect(byId('x1')).toBeDefined();
    expect(byId('b1')).toBeDefined();
  });
});
