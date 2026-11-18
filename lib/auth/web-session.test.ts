import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWebSession,
  endOtherSessions,
  extendWebSession,
  purgeExpiredWebSessions,
  revokeUserWebSessions,
  revokeWebSession,
  webSessionExpiry,
  webSessionNeedsExtension,
} from './web-session';

// Issue #1127: the web_session rows behind server-side revocation.
const policy = { maxAge: 30 * 86_400, updateAge: 86_400 };

function fakeDb() {
  return {
    web_session: {
      create: vi.fn(async () => ({ id: 's-new' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
      deleteMany: vi.fn(async () => ({ count: 2 })),
    },
  };
}

let db: ReturnType<typeof fakeDb>;
beforeEach(() => {
  db = fakeDb();
});

describe('row lifetime', () => {
  const now = new Date('2026-11-18T00:00:00Z');

  it('outlives the cookie by one refresh interval', () => {
    expect(webSessionExpiry(policy, now).getTime() - now.getTime()).toBe((policy.maxAge + policy.updateAge) * 1000);
  });

  it('is extended only once less than maxAge is left, so at most once per updateAge', () => {
    const fresh = webSessionExpiry(policy, now);
    expect(webSessionNeedsExtension(fresh, policy, now)).toBe(false);
    const almostADay = new Date(now.getTime() + policy.updateAge * 1000 - 1000);
    expect(webSessionNeedsExtension(fresh, policy, almostADay)).toBe(false);
    const aDayLater = new Date(now.getTime() + policy.updateAge * 1000 + 1000);
    expect(webSessionNeedsExtension(fresh, policy, aDayLater)).toBe(true);
  });
});

describe('writes', () => {
  it('creates a row for the user, clearing that user\'s expired rows first', async () => {
    const id = await createWebSession('u1', policy, db as never);
    expect(id).toBe('s-new');
    expect(db.web_session.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1', expires_at: { lt: expect.any(Date) } } });
    expect(db.web_session.create).toHaveBeenCalledWith({
      data: { user_id: 'u1', expires_at: expect.any(Date) },
      select: { id: true },
    });
  });

  it('extends without recreating a revoked row', async () => {
    await extendWebSession('s1', policy, db as never);
    expect(db.web_session.updateMany).toHaveBeenCalledWith({ where: { id: 's1' }, data: { expires_at: expect.any(Date) } });
  });

  it('revokes one session', async () => {
    await expect(revokeWebSession('s1', db as never)).resolves.toBe(true);
    expect(db.web_session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('revokes every session of a user, or every one but the current', async () => {
    await expect(revokeUserWebSessions('u1', {}, db as never)).resolves.toBe(2);
    expect(db.web_session.deleteMany).toHaveBeenLastCalledWith({ where: { user_id: 'u1' } });
    await revokeUserWebSessions('u1', { exceptSessionId: 's1' }, db as never);
    expect(db.web_session.deleteMany).toHaveBeenLastCalledWith({ where: { user_id: 'u1', id: { not: 's1' } } });
  });

  it('purges expired rows', async () => {
    const now = new Date();
    await purgeExpiredWebSessions(now, db as never);
    expect(db.web_session.deleteMany).toHaveBeenCalledWith({ where: { expires_at: { lt: now } } });
  });
});

describe('endOtherSessions', () => {
  function sessionsDb() {
    return {
      web_session: { deleteMany: vi.fn(async () => ({ count: 3 })) },
      mobile_session: { updateMany: vi.fn(async () => ({ count: 2 })) },
    };
  }

  it('ends every web and mobile session of the user but the current ones', async () => {
    const sdb = sessionsDb();
    const ended = await endOtherSessions('u1', { webSessionId: 'w1', mobileSessionId: 'm1' }, sdb as never);
    expect(ended).toEqual({ web: 3, mobile: 2 });
    expect(sdb.web_session.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1', id: { not: 'w1' } } });
    expect(sdb.mobile_session.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', revoked_at: null, id: { not: 'm1' } },
      data: { revoked_at: expect.any(Date) },
    });
  });

  it('ends every session when the request has none of its own (an API key)', async () => {
    const sdb = sessionsDb();
    await endOtherSessions('u1', {}, sdb as never);
    expect(sdb.web_session.deleteMany).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
    expect(sdb.mobile_session.updateMany).toHaveBeenCalledWith({
      where: { user_id: 'u1', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
  });
});
