// audit_log digest chain operations (docs/knowledge/audit-log-append-only.md).
//
//   npm run audit-log:digest -- close              close ended periods, write digests
//   npm run audit-log:digest -- verify             recompute the chain and compare (exit 1 on mismatch)
//   npm run audit-log:digest -- export-month YYYY-MM   export a month to storage (retention procedure)
//   npm run audit-log:digest -- ensure-partitions  create the current and next month partitions (table owner)
//
// Storage is a local directory (AUDIT_LOG_STORAGE_DIR) for tests and local runs. A
// deployment replaces it with a write-once bucket by implementing AuditLogStorage.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pinSslModeVerifyFull } from '../lib/db-url';
import { closeAuditLogPeriods, verifyAuditLogDigests } from '../lib/audit-log-integrity/digest';
import { archiveRowSource, exportAuditLogMonth } from '../lib/audit-log-integrity/partition-export';
import { LocalDirectoryStorage } from '../lib/audit-log-integrity/storage';

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);
  const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawConnectionString) throw new Error('DATABASE_URL is required.');
  const storageDir = process.env.AUDIT_LOG_STORAGE_DIR;
  if (!storageDir && command !== 'ensure-partitions') throw new Error('AUDIT_LOG_STORAGE_DIR is required.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pinSslModeVerifyFull(rawConnectionString) }) });
  try {
    const storage = new LocalDirectoryStorage(path.resolve(storageDir ?? '.'));
    switch (command) {
      case 'close': {
        const closed = await closeAuditLogPeriods(prisma, storage);
        console.log(`closed ${closed.length} period(s)`);
        return 0;
      }
      case 'verify': {
        const result = await verifyAuditLogDigests(prisma, storage, { archiveRowSource: archiveRowSource(storage) });
        console.log(`checked ${result.periodsChecked} period(s)`);
        for (const p of result.problems) console.error(`MISMATCH ${p.period_start} ${p.kind}: ${p.detail}`);
        return result.ok ? 0 : 1;
      }
      case 'export-month': {
        if (!arg) throw new Error('Usage: export-month YYYY-MM');
        const exported = await exportAuditLogMonth(prisma, storage, arg);
        console.log(`exported ${exported.rowCount} row(s) to ${exported.key} (sha256 ${exported.sha256})`);
        return 0;
      }
      case 'ensure-partitions': {
        const created = await prisma.$queryRaw<{ name: string }[]>`
          SELECT audit_log_create_month_partition(now()) AS name
          UNION SELECT audit_log_create_month_partition(now() + interval '1 month')`;
        console.log(`partitions: ${created.map((r) => r.name).join(', ')}`);
        return 0;
      }
      default:
        throw new Error('Usage: close | verify | export-month YYYY-MM | ensure-partitions');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
