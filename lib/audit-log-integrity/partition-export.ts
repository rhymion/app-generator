/**
 * Partition export helper for the audit_log retention procedure.
 *
 * Retention archives a whole monthly partition instead of deleting rows:
 *   1. `exportAuditLogMonth` writes the month's rows to storage as JSON Lines
 *      and records the file's SHA-256 next to it.
 *   2. The consumer's procedure copies/locks the file in its WORM store.
 *   3. The table owner detaches and drops the partition (DDL, never a row
 *      DELETE): `ALTER TABLE audit_log DETACH PARTITION audit_log_YYYY_MM;
 *      DROP TABLE audit_log_YYYY_MM;`
 * `archiveRowSource` lets `verifyAuditLogDigests` check archived periods from
 * the files. Who runs this, when, and how each run is recorded is a consumer
 * operation (docs/knowledge/audit-log-append-only.md).
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/app/generated/prisma/client';
import { databaseRowSource, type AuditRow, type AuditRowSource } from './digest';
import type { AuditLogStorage } from './storage';

export type ArchiveExport = { key: string; sha256Key: string; sha256: string; rowCount: number };

function monthBounds(month: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
    throw new Error(`Expected a month as YYYY-MM, got: ${month}`);
  }
  const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
  return { start, end };
}

export function archiveStorageKey(month: string): string {
  monthBounds(month);
  return `archive/audit_log_${month.replace('-', '_')}.jsonl`;
}

function toLine(row: AuditRow): string {
  return JSON.stringify({ ...row, created_at: row.created_at.toISOString() });
}

export async function exportAuditLogMonth(
  client: Pick<PrismaClient, '$queryRaw'>,
  storage: AuditLogStorage,
  month: string,
): Promise<ArchiveExport> {
  const { start, end } = monthBounds(month);
  const lines: string[] = [];
  for await (const row of databaseRowSource(client)(start, end)) lines.push(toLine(row));
  const body = lines.map((l) => `${l}\n`).join('');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const key = archiveStorageKey(month);
  const sha256Key = `${key}.sha256`;
  await storage.put(key, body);
  await storage.put(sha256Key, `${sha256}\n`);
  return { key, sha256Key, sha256, rowCount: lines.length };
}

/** Rows from archive files, for periods whose partition was dropped. Checks each file against its recorded SHA-256. */
export function archiveRowSource(storage: AuditLogStorage): AuditRowSource {
  return async function* (start, end) {
    const months = new Set<string>();
    for (let t = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); t < end; ) {
      months.add(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1));
    }
    for (const month of months) {
      const key = archiveStorageKey(month);
      const body = await storage.get(key);
      if (body === null) continue;
      const recorded = (await storage.get(`${key}.sha256`))?.trim();
      if (recorded !== createHash('sha256').update(body).digest('hex')) {
        throw new Error(`Archive ${key} does not match its recorded SHA-256`);
      }
      for (const line of body.split('\n')) {
        if (!line) continue;
        const row = JSON.parse(line) as Omit<AuditRow, 'created_at'> & { created_at: string };
        const createdAt = new Date(row.created_at);
        if (createdAt >= start && createdAt < end) yield { ...row, created_at: createdAt };
      }
    }
  };
}
