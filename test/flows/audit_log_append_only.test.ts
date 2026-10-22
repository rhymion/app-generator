// audit_log append-only (app-generator #945): runs against the real test
// Postgres (`npm run db:push` + `npm run db:apply-audit-log-sql` already run, as
// in `npm run test:e2e:build`). Covers: the row trigger rejects UPDATE/DELETE,
// the application guard rejects update/delete calls, the digest verification
// passes on untouched data and fails after a row is changed with the trigger
// disabled, and the partition export round trip.
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');

import { Client } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const { default: prisma } = await import('@/lib/prisma');
const { closeAuditLogPeriods, verifyAuditLogDigests } = await import('@/lib/audit-log-integrity/digest');
const { archiveRowSource, exportAuditLogMonth } = await import('@/lib/audit-log-integrity/partition-export');
const { LocalDirectoryStorage } = await import('@/lib/audit-log-integrity/storage');
const { AuditLogAppendOnlyError } = await import('@/lib/audit-log-integrity/guard');
const { recordAuditEvent } = await import('@/lib/audit-log');

async function ownerQuery<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const truncate = () => ownerQuery((c) => c.query('TRUNCATE TABLE audit_log, audit_log_digest'));

// Fixed historic days far from "now" so no live partition boundary is involved.
const day1 = new Date('2026-03-10T00:00:00Z');
const day2 = new Date('2026-03-11T00:00:00Z');
const now = new Date('2026-03-12T05:00:00Z');

async function seedRows() {
  await prisma.audit_log.createMany({
    data: [
      { id: 'r1', action: 'test:one', metadata: { k: 'v' }, created_at: new Date(day1.getTime() + 60_000) },
      { id: 'r2', action: 'test:two', created_at: new Date(day1.getTime() + 120_000) },
      { id: 'r3', action: 'test:three', created_at: new Date(day2.getTime() + 60_000) },
    ],
  });
}

describe('audit_log append-only', () => {
  let storage: InstanceType<typeof LocalDirectoryStorage>;

  beforeEach(async () => {
    await truncate();
    storage = new LocalDirectoryStorage(await mkdtemp(path.join(os.tmpdir(), 'audit-log-')));
  });
  afterAll(async () => {
    await truncate();
    await prisma.$disconnect();
  });

  it('is created through the application and recordAuditEvent still works', async () => {
    await recordAuditEvent({ action: 'test:record' });
    expect(await prisma.audit_log.count({ where: { action: 'test:record' } })).toBe(1);
  });

  it('rejects UPDATE and DELETE in the database (row trigger)', async () => {
    await seedRows();
    await ownerQuery(async (c) => {
      await expect(c.query(`UPDATE audit_log SET action = 'x' WHERE id = 'r1'`)).rejects.toThrow(/append-only/);
      await expect(c.query(`DELETE FROM audit_log WHERE id = 'r1'`)).rejects.toThrow(/append-only/);
      await expect(c.query(`UPDATE audit_log_digest SET digest = 'x'`)).resolves.toBeDefined(); // no rows yet
    });
    expect(await prisma.audit_log.count()).toBe(3);
  });

  it('rejects update and delete calls in the application (client guard)', async () => {
    await seedRows();
    await expect(prisma.audit_log.update({ where: { id_created_at: { id: 'r1', created_at: new Date(day1.getTime() + 60_000) } }, data: { action: 'x' } })).rejects.toThrow(AuditLogAppendOnlyError);
    await expect(prisma.audit_log.deleteMany()).rejects.toThrow(AuditLogAppendOnlyError);
    await expect(prisma.audit_log.updateMany({ data: { action: 'x' } })).rejects.toThrow(AuditLogAppendOnlyError);
    expect(await prisma.audit_log.count()).toBe(3);
  });

  it('allows TRUNCATE for the owner (test teardown)', async () => {
    await seedRows();
    await truncate();
    expect(await prisma.audit_log.count()).toBe(0);
  });

  it('lets the restricted application role create a monthly partition but nothing else', async () => {
    const role = 'audit_log_probe_app';
    const appRoleSql = (await readFile(path.resolve(process.cwd(), 'prisma/sql/audit_log_app_role.sql'), 'utf8')).replaceAll(
      ':"app_role"',
      `"${role}"`,
    );
    const url = new URL(process.env.DATABASE_URL as string);
    url.username = role;
    url.password = 'probe';
    await ownerQuery(async (c) => {
      await c.query(`DROP OWNED BY ${role}`).catch(() => undefined);
      await c.query(`DROP ROLE IF EXISTS ${role}`);
      await c.query(`CREATE ROLE ${role} LOGIN PASSWORD 'probe'`);
      await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await c.query(appRoleSql);
    });
    const app = new Client({ connectionString: url.toString() });
    await app.connect();
    try {
      // A month far from "now" so no live partition is involved.
      const result = await app.query(`SELECT audit_log_create_month_partition('2031-07-15T00:00:00Z') AS name`);
      expect(result.rows[0].name).toBe('audit_log_2031_07');
      await expect(app.query(`DROP TABLE audit_log_2031_07`)).rejects.toThrow(/must be owner|permission denied/);
      await expect(app.query(`TRUNCATE TABLE audit_log`)).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
      await ownerQuery(async (c) => {
        await c.query('DROP TABLE IF EXISTS audit_log_2031_07');
        await c.query(`DROP OWNED BY ${role}`);
        await c.query(`DROP ROLE ${role}`);
      });
    }
  });

  it('verification passes on untouched data and is idempotent', async () => {
    await seedRows();
    const closed = await closeAuditLogPeriods(prisma, storage, { now });
    expect(closed.map((r) => [r.period_start, r.row_count])).toEqual([
      ['2026-03-10T00:00:00.000Z', 2],
      ['2026-03-11T00:00:00.000Z', 1],
    ]);
    expect(closed[1].previous_digest).toBe(closed[0].digest);
    expect(await closeAuditLogPeriods(prisma, storage, { now })).toEqual([]);
    const result = await verifyAuditLogDigests(prisma, storage);
    expect(result).toEqual({ ok: true, periodsChecked: 2, problems: [] });
  });

  it('does not close a period before the margin has passed', async () => {
    await seedRows();
    const closed = await closeAuditLogPeriods(prisma, storage, { now: new Date('2026-03-11T01:30:00Z') });
    expect(closed).toHaveLength(1);
  });

  it('verification fails after a row is changed with the trigger disabled', async () => {
    await seedRows();
    await closeAuditLogPeriods(prisma, storage, { now });
    await ownerQuery(async (c) => {
      await c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only');
      try {
        await c.query(`UPDATE audit_log SET action = 'tampered' WHERE id = 'r2'`);
      } finally {
        await c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only');
      }
    });
    const result = await verifyAuditLogDigests(prisma, storage);
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => [p.period_start, p.kind])).toEqual(
      expect.arrayContaining([
        ['2026-03-10T00:00:00.000Z', 'digest_mismatch'],
        ['2026-03-10T00:00:00.000Z', 'storage_mismatch'],
      ]),
    );
    expect(result.problems.some((p) => p.period_start === '2026-03-11T00:00:00.000Z')).toBe(false);
  });

  it('verification fails after a row is deleted with the trigger disabled', async () => {
    await seedRows();
    await closeAuditLogPeriods(prisma, storage, { now });
    await ownerQuery(async (c) => {
      await c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only');
      try {
        await c.query(`DELETE FROM audit_log WHERE id = 'r3'`);
      } finally {
        await c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only');
      }
    });
    const result = await verifyAuditLogDigests(prisma, storage);
    expect(result.problems.map((p) => p.kind)).toContain('row_count_mismatch');
  });

  it('exports a month, and verification can read the archive after the rows are gone', async () => {
    await seedRows();
    await closeAuditLogPeriods(prisma, storage, { now });
    const exported = await exportAuditLogMonth(prisma, storage, '2026-03');
    expect(exported.rowCount).toBe(3);
    // Stands in for DETACH + DROP of the archived partition (the digests stay).
    await ownerQuery((c) => c.query('TRUNCATE TABLE audit_log'));
    const withoutArchive = await verifyAuditLogDigests(prisma, storage);
    expect(withoutArchive.ok).toBe(false);
    const withArchive = await verifyAuditLogDigests(prisma, storage, { archiveRowSource: archiveRowSource(storage) });
    expect(withArchive.problems.filter((p) => p.kind !== 'chain_break')).toEqual([]);
  });
});
