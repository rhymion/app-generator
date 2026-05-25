// Script to seed ITS (Issue Tracking System) database with sample data
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';
import { createId } from "@paralleldrive/cuid2";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is required. Set NODE_ENV=test for test defaults, or create .env.local for local secrets.'
  );
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding tenant...');

  // ── Default tenant ────────────────────────────────────────────────────────
  // Phase 1 multi-tenancy: every user has a NOT NULL `tenant_id`. The
  // bootstrap "default" tenant must exist before any user is inserted —
  // its id is the literal string 'default' so it matches the column
  // default on `user.tenant_id` and the backfill value used by the 1.5
  // migration script. Creator/updater stay null on first run; once an
  // admin exists they could be backfilled, but it isn't required.
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: 'default',
      slug: 'default',
      name: 'Default Tenant',
      status: 'active',
    },
  });

  console.log('Tenant seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
