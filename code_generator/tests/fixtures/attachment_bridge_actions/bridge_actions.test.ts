import { beforeEach, describe, expect, it } from 'vitest';
import { setAttachmentsForBridge } from '@/lib/attachment/bridge_actions';
import { db, reset } from './fake/prisma';

const byId = (id: string) => db.attachments.find((r) => r.id === id);

beforeEach(() => reset());

describe('setAttachmentsForBridge ownership', () => {
  it('rejects an id owned by another record of the same organization and changes nothing', async () => {
    await expect(
      setAttachmentsForBridge('attA1', 1, [{ id: 'x1', name: 'evil', path: '/evil.png' }]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('x1')).toMatchObject({ name: 'x1', path: '/x1.png', attachable_id: 'attA2' });
    expect(byId('a1')).toBeDefined();
    expect(byId('a2')).toBeDefined();
  });

  it('rejects an id owned by a record of another organization and changes nothing', async () => {
    await expect(
      setAttachmentsForBridge('attA1', 1, [{ id: 'b1', name: 'evil', path: '/evil.png' }]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('b1')).toMatchObject({ name: 'b1', path: '/b1.png', attachable_id: 'attB1' });
    expect(byId('a1')).toBeDefined();
    expect(byId('a2')).toBeDefined();
  });

  it('rejects the whole call when only one of several ids is foreign', async () => {
    await expect(
      setAttachmentsForBridge('attA1', 1, [
        { id: 'a1', name: 'renamed', path: '/renamed.png' },
        { id: 'b1', name: 'evil', path: '/evil.png' },
      ]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('a1')).toMatchObject({ name: 'a1', path: '/a1.png' });
    expect(byId('a2')).toBeDefined();
  });

  it('rejects an id of the same record but another attachment type', async () => {
    await expect(
      setAttachmentsForBridge('attA1', 1, [{ id: 'a3', name: 'x', path: '/x.png' }]),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(byId('a3')).toMatchObject({ name: 'a3', type: 2 });
  });

  it('still refuses a caller who may not edit the attachable', async () => {
    await expect(
      setAttachmentsForBridge('attB1', 1, [{ id: 'b1', name: 'x', path: '/x.png' }]),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('keeps replace semantics and ordering for the record own attachments', async () => {
    await setAttachmentsForBridge('attA1', 1, [
      { id: 'a2', name: 'second', path: '/second.png' },
      { name: 'fresh', path: '/fresh.png' },
    ]);
    const mine = db.attachments.filter((r) => r.attachable_id === 'attA1' && r.type === 1);
    expect(mine.map((r) => [r.id === 'a2' ? 'a2' : 'new', r.name, r.path, r.order])).toEqual([
      ['a2', 'enc-second', '/second.png', 0],
      ['new', 'enc-fresh', '/fresh.png', 1],
    ]);
    expect(byId('a1')).toBeUndefined();
    expect(byId('a3')).toBeDefined();
    expect(byId('x1')).toBeDefined();
    expect(byId('b1')).toBeDefined();
  });
});
