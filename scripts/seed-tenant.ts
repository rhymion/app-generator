// Script to seed ITS (Issue Tracking System) database with sample data
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';
import { createId } from "@paralleldrive/cuid2";
import { resolveAdminCredentials, requiresExplicitCredentials } from './seed-tenant-credentials';

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

  // ── PostgreSQL extensions required for full-text search ──────────────────
  // pg_trgm provides the similarity() function used by GET /api/search.
  // CREATE EXTENSION IF NOT EXISTS is idempotent.
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');

  // ── Default tenant ────────────────────────────────────────────────────────
  // Phase 1 multi-tenancy: every user has a NOT NULL `tenant_id`. The
  // bootstrap "default" tenant must exist before any user is inserted —
  // its id is the literal string 'default' so it matches the column
  // default on `user.tenant_id` and the backfill value used by the 1.5
  // migration script. Creator/updater stay null on first run; once an
  // admin exists they could be backfilled, but it isn't required.
  await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: 'default',
      slug: 'default',
      name: 'Default Tenant',
      status: 'active',
    },
  });

  // ── Admin user ────────────────────────────────────────────────────────────
  // Created here so db:seed-tenant is sufficient for tests requiring a
  // sign-in with admin@example.com. Future default permission of 'none'
  // means the admin must exist before general seeding adds any other data.
  //
  // Credentials come from resolveAdminCredentials (scripts/seed-tenant-credentials.ts):
  // under NODE_ENV=production it fail-fasts unless SEED_ADMIN_EMAIL/
  // SEED_ADMIN_PASSWORD are set and always mints a fresh random api_key —
  // app-generator is a public repo, so the well-known admin@example.com/
  // password123/mk_78d1e51a... literal must never land in a real deployment.
  // Every other NODE_ENV (test, development, ...) keeps those exact defaults
  // unchanged, since cypress specs and vitest fixtures are pinned to them.
  // See docs/knowledge/seed-tenant-credential-hardening.md.
  const credentials = resolveAdminCredentials(process.env);
  const hashedPassword = await bcrypt.hash(credentials.password, 10);
  const adminId = createId();
  const admin = await prisma.user.upsert({
    where: { email: credentials.email },
    update: {},
    create: {
      id: adminId,
      creator_id: adminId,
      updater_id: adminId,
      api_key: credentials.apiKey,
      email: credentials.email,
      name: 'Test Admin',
      password: hashedPassword,
    },
  });

  // The upsert's `update: {}` means an existing admin row is never touched —
  // on a second run the freshly-generated api_key above was never written,
  // so print exactly what `admin` (the actual post-upsert row) holds. Stdout
  // only, once, never written to a log file/collector — see requirement 1.
  if (requiresExplicitCredentials(process.env.NODE_ENV)) {
    console.log(`Admin api_key (store this now — it is not shown again): ${admin.api_key}`);
  }

  // ── Administrator role + full CRUD permissions ────────────────────────────
  let adminRole = await prisma.role.findFirst({ where: { name: 'Administrator' } });
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        name: 'Administrator',
        description: 'Administrator permissions',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.role.update({
    where: { id: adminRole.id },
    data: { users: { connect: { id: admin.id } } },
  });

  // Fixed enumeration, not schema-derived: any entity a consumer adds on top
  // of the default schema (e.g. purchase_order, shift) never appears here,
  // so the Administrator role gets zero permissions on it until an admin
  // grants them via the Permissions UI. This is a deliberate design
  // boundary, not a bug — see docs/knowledge/seed-tenant-credential-hardening.md
  // §"Fixed permission enumeration".
  const entities = [
    'user', 'role', 'organization', 'permission', 'setting',
    'approval_request', 'approval_flow',
    'dashboard',
  ];
  await Promise.all(entities.map(entity =>
    prisma.permission.upsert({
      where: { name_role_id: { name: entity, role_id: adminRole!.id } },
      update: {},
      create: {
        name: entity,
        role_id: adminRole!.id,
        creator_id: admin.id,
        updater_id: admin.id,
        create: true,
        read: true,
        update: true,
        delete: true,
      },
    })
  ));

  await prisma.permission.upsert({
    where: { name_role_id: { name: 'audit_log', role_id: adminRole!.id } },
    update: {},
    create: {
      name: 'audit_log',
      role_id: adminRole!.id,
      creator_id: admin.id,
      updater_id: admin.id,
      create: false,
      read: true,
      update: false,
      delete: false,
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
