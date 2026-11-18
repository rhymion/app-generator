// Deletes expired rows (Issue #1299): idempotency rows past their one-day retention, with the
// response bodies they stored, and expired web_session rows.
//
//   npm run db:purge-expired
//
// Safe to run at any time; schedule it with the platform's cron (for example daily). Prints how
// many rows of each kind were deleted. See docs/knowledge/api-idempotency-and-rate-limiting.md.
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pinSslModeVerifyFull } from '../lib/db-url';
import { purgeExpiredRows } from '../lib/housekeeping';

async function main(): Promise<void> {
  const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawConnectionString) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: pinSslModeVerifyFull(rawConnectionString) }) });
  try {
    const counts = await purgeExpiredRows(prisma as never);
    console.log(`idempotency_key: ${counts.idempotencyKeys} deleted`);
    console.log(`web_session: ${counts.webSessions} deleted`);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
