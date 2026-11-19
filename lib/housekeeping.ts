/**
 * Deletes rows that can no longer be used (Issue #1299): idempotency rows past their one-day
 * retention, with the response bodies they stored, and web_session rows past their purge time.
 * Run by `npm run db:purge-expired` (scripts/purge-expired.ts); schedule it with the platform's
 * cron, for example daily. Every delete is by expiry only, so running it at any time, or twice,
 * changes no answer the application gives.
 */
import type prisma from '@/lib/prisma';
import { purgeExpiredIdempotencyKeys } from '@/lib/idempotency';
import { purgeExpiredWebSessions } from '@/lib/auth/web-session';

export type PurgeCounts = { idempotencyKeys: number; webSessions: number };

export async function purgeExpiredRows(
  db: Pick<typeof prisma, 'idempotency_key' | 'web_session'>,
  now: Date = new Date(),
): Promise<PurgeCounts> {
  const idempotencyKeys = await purgeExpiredIdempotencyKeys(db, now);
  const webSessions = await purgeExpiredWebSessions(now, db);
  return { idempotencyKeys, webSessions };
}
