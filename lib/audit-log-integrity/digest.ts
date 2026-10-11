/**
 * Digest chain over closed `audit_log` periods, plus its verification.
 *
 * Detection layer of docs/knowledge/audit-log-append-only.md: each closed
 * period (one UTC day by default) gets a SHA-256 digest over its rows in a
 * fixed order and a fixed serialization, chained to the previous period's
 * digest. The digest is stored in `audit_log_digest` and in an
 * `AuditLogStorage` (write-once object storage in production). A change made
 * with elevated privileges, including one made with the trigger disabled,
 * shows up as a mismatch when `verifyAuditLogDigests` recomputes the chain.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/app/generated/prisma/client';
import type { AuditLogStorage } from './storage';

export const DEFAULT_PERIOD_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MARGIN_MS = 60 * 60 * 1000;
const BATCH_SIZE = 1000;

export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  metadata: unknown;
  created_at: Date;
};

/** Yields the rows with `start <= created_at < end` ordered by created_at, then id. */
export type AuditRowSource = (start: Date, end: Date) => AsyncIterable<AuditRow>;

export type DigestRecord = {
  period_start: string;
  period_end: string;
  row_count: number;
  digest: string;
  previous_digest: string | null;
};

type DigestClient = Pick<PrismaClient, '$queryRaw' | 'audit_log_digest'>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

/** Fixed serialization of one row: every column, metadata with sorted keys. */
export function serializeAuditRow(row: AuditRow): string {
  return JSON.stringify([
    row.id,
    row.actor_user_id,
    row.action,
    row.target_table,
    row.target_id,
    row.metadata === null || row.metadata === undefined ? null : canonicalize(row.metadata),
    row.created_at.toISOString(),
  ]);
}

export async function digestRows(
  rows: AsyncIterable<AuditRow>,
  start: Date,
  end: Date,
  previousDigest: string | null,
): Promise<{ digest: string; rowCount: number }> {
  const hash = createHash('sha256');
  hash.update(`${start.toISOString()}|${end.toISOString()}|${previousDigest ?? ''}\n`);
  let rowCount = 0;
  for await (const row of rows) {
    hash.update(`${serializeAuditRow(row)}\n`);
    rowCount += 1;
  }
  return { digest: hash.digest('hex'), rowCount };
}

/** Rows read from the live `audit_log` table, in batches (keyset pagination). */
export function databaseRowSource(client: Pick<PrismaClient, '$queryRaw'>): AuditRowSource {
  return async function* (start, end) {
    // The id order is byte-wise (COLLATE "C") so it does not depend on the
    // database's default collation.
    let cursorAt = new Date(start.getTime() - 1000);
    let cursorId = '';
    for (;;) {
      const batch = await client.$queryRaw<AuditRow[]>`
        SELECT id, actor_user_id, action, target_table, target_id, metadata, created_at
        FROM audit_log
        WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz
          AND (created_at, id COLLATE "C") > (${cursorAt}::timestamptz, ${cursorId}::text)
        ORDER BY created_at, id COLLATE "C"
        LIMIT ${BATCH_SIZE}`;
      for (const row of batch) yield row;
      if (batch.length < BATCH_SIZE) return;
      const last = batch[batch.length - 1];
      cursorAt = last.created_at;
      cursorId = last.id;
    }
  };
}

export function digestStorageKey(periodStart: Date): string {
  return `digests/${periodStart.toISOString().replace(/[:.]/g, '-')}.json`;
}

function serializeRecord(record: DigestRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export type CloseOptions = {
  now?: Date;
  periodMs?: number;
  /** A period is closed only once `now` is this far past its end, so rows from transactions in flight at the boundary are included. */
  marginMs?: number;
};

/**
 * Close every period that has ended (plus the margin) and has no digest yet.
 * Safe to run repeatedly: each run continues from the last digest.
 */
export async function closeAuditLogPeriods(
  client: DigestClient,
  storage: AuditLogStorage,
  options: CloseOptions = {},
): Promise<DigestRecord[]> {
  const now = options.now ?? new Date();
  const periodMs = options.periodMs ?? DEFAULT_PERIOD_MS;
  const marginMs = options.marginMs ?? DEFAULT_MARGIN_MS;

  const last = await client.audit_log_digest.findFirst({ orderBy: { period_start: 'desc' } });
  let start: Date;
  let previousDigest: string | null = null;
  if (last) {
    start = last.period_end;
    previousDigest = last.digest;
  } else {
    const [{ earliest }] = await client.$queryRaw<{ earliest: Date | null }[]>`
      SELECT min(created_at) AS earliest FROM audit_log`;
    if (!earliest) return [];
    start = new Date(Math.floor(earliest.getTime() / periodMs) * periodMs);
  }

  const source = databaseRowSource(client);
  const closed: DigestRecord[] = [];
  for (;;) {
    const end = new Date(start.getTime() + periodMs);
    if (end.getTime() + marginMs > now.getTime()) break;
    const { digest, rowCount } = await digestRows(source(start, end), start, end, previousDigest);
    const record: DigestRecord = {
      period_start: start.toISOString(),
      period_end: end.toISOString(),
      row_count: rowCount,
      digest,
      previous_digest: previousDigest,
    };
    // Storage first: a retry after a failed insert re-puts identical content.
    await storage.put(digestStorageKey(start), serializeRecord(record));
    await client.audit_log_digest.create({
      data: {
        period_start: start,
        period_end: end,
        row_count: rowCount,
        digest,
        previous_digest: previousDigest,
      },
    });
    closed.push(record);
    previousDigest = digest;
    start = end;
  }
  return closed;
}

export type VerificationProblem = {
  period_start: string;
  kind:
    | 'chain_break'
    | 'row_count_mismatch'
    | 'digest_mismatch'
    | 'storage_missing'
    | 'storage_mismatch';
  detail: string;
};

export type VerificationResult = {
  ok: boolean;
  periodsChecked: number;
  problems: VerificationProblem[];
};

export type VerifyOptions = {
  /** Rows for periods whose live rows were archived and dropped; read from the archive files. */
  archiveRowSource?: AuditRowSource;
};

/** Recompute every digest from the rows and compare with the table and the storage copy. */
export async function verifyAuditLogDigests(
  client: DigestClient,
  storage: AuditLogStorage,
  options: VerifyOptions = {},
): Promise<VerificationResult> {
  const stored = await client.audit_log_digest.findMany({ orderBy: { period_start: 'asc' } });
  const databaseRows = databaseRowSource(client);
  const problems: VerificationProblem[] = [];
  let previous: (typeof stored)[number] | null = null;

  for (const row of stored) {
    const periodStart = row.period_start.toISOString();
    if (previous) {
      if (row.previous_digest !== previous.digest || row.period_start.getTime() !== previous.period_end.getTime()) {
        problems.push({
          period_start: periodStart,
          kind: 'chain_break',
          detail: 'period does not follow the previous digest',
        });
      }
    }

    let recomputed = await digestRows(
      databaseRows(row.period_start, row.period_end),
      row.period_start,
      row.period_end,
      row.previous_digest,
    );
    if (recomputed.rowCount === 0 && row.row_count > 0 && options.archiveRowSource) {
      recomputed = await digestRows(
        options.archiveRowSource(row.period_start, row.period_end),
        row.period_start,
        row.period_end,
        row.previous_digest,
      );
    }
    if (recomputed.rowCount !== row.row_count) {
      problems.push({
        period_start: periodStart,
        kind: 'row_count_mismatch',
        detail: `recorded ${row.row_count} rows, found ${recomputed.rowCount}`,
      });
    }
    if (recomputed.digest !== row.digest) {
      problems.push({
        period_start: periodStart,
        kind: 'digest_mismatch',
        detail: 'recomputed digest differs from the recorded digest',
      });
    }

    const copy = await storage.get(digestStorageKey(row.period_start));
    if (copy === null) {
      problems.push({ period_start: periodStart, kind: 'storage_missing', detail: 'no copy in storage' });
    } else {
      let parsed: Partial<DigestRecord> = {};
      try {
        parsed = JSON.parse(copy) as Partial<DigestRecord>;
      } catch {
        // falls through to the mismatch report below
      }
      if (parsed.digest !== recomputed.digest || parsed.row_count !== recomputed.rowCount) {
        problems.push({
          period_start: periodStart,
          kind: 'storage_mismatch',
          detail: 'stored copy differs from the recomputed digest',
        });
      }
    }
    previous = row;
  }
  return { ok: problems.length === 0, periodsChecked: stored.length, problems };
}
