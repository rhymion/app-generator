import { describe, expect, it, vi } from 'vitest';
import { purgeExpiredRows } from './housekeeping';
import { IDEMPOTENCY_RETENTION_MS, purgeExpiredIdempotencyKeys } from './idempotency';

// Issue #1299: expired idempotency rows (and their stored response bodies) and expired web
// sessions are deleted, by expiry only.
function fakeDb() {
  return {
    idempotency_key: { deleteMany: vi.fn(async () => ({ count: 4 })) },
    web_session: { deleteMany: vi.fn(async () => ({ count: 2 })) },
  };
}

describe('purgeExpiredIdempotencyKeys', () => {
  it('deletes only rows older than the one-day retention', async () => {
    const db = fakeDb();
    const now = new Date('2026-11-18T12:00:00Z');
    expect(await purgeExpiredIdempotencyKeys(db, now)).toBe(4);
    expect(db.idempotency_key.deleteMany).toHaveBeenCalledWith({
      where: { created_at: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
    });
    expect(IDEMPOTENCY_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('purgeExpiredRows', () => {
  it('purges expired idempotency rows and expired web sessions', async () => {
    const db = fakeDb();
    const now = new Date('2026-11-18T12:00:00Z');
    expect(await purgeExpiredRows(db as never, now)).toEqual({ idempotencyKeys: 4, webSessions: 2 });
    expect(db.web_session.deleteMany).toHaveBeenCalledWith({ where: { expires_at: { lt: now } } });
  });
});
