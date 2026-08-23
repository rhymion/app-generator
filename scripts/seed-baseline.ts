// Script to seed ITS (Issue Tracking System) database with sample data
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
loadEnvConfig(path.resolve(process.cwd()), process.env.NODE_ENV !== 'production');
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';
import { createId } from "@paralleldrive/cuid2";
import { resolveAdminCredentials, requiresExplicitCredentials } from './seed-baseline-credentials';
import { pinSslModeVerifyFull } from '../lib/db-url';
import { SCHEDULED_TASK_ACTOR_EMAIL } from '../lib/scheduled-tasks/system-actor';

const rawConnectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!rawConnectionString) {
  throw new Error(
    'DATABASE_URL is required. Set NODE_ENV=test for test defaults, or create .env.local for local secrets.'
  );
}
// Pin the SSL verification mode Neon's DSN embeds (sslmode=require) so a
// future pg-connection-string major version doesn't silently weaken it;
// see lib/db-url.ts. No-op for local/CI URLs, which have no sslmode param.
const connectionString = pinSslModeVerifyFull(rawConnectionString);
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
  // Created here so db:seed-baseline is sufficient for tests requiring a
  // sign-in with admin@example.com. Future default permission of 'none'
  // means the admin must exist before general seeding adds any other data.
  //
  // Credentials come from resolveAdminCredentials (scripts/seed-baseline-credentials.ts):
  // under NODE_ENV=production it fail-fasts unless SEED_ADMIN_EMAIL/
  // SEED_ADMIN_PASSWORD are set and always mints a fresh random api_key —
  // app-generator is a public repo, so the well-known admin@example.com/
  // password123/mk_78d1e51a... literal must never land in a real deployment.
  // Every other NODE_ENV (test, development, ...) keeps those exact defaults
  // unchanged, since cypress specs and vitest fixtures are pinned to them.
  // See docs/knowledge/seed-baseline-credential-hardening.md.
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

  // ── Scheduled-task system actor (cmd_781) ─────────────────────────────────
  // Every x-scheduled-task run (app/api/scheduled-tasks/[task]/route.ts)
  // attributes its writes to this one dedicated account — never to whichever
  // credential (Vercel Cron's CRON_SECRET, or a manual X-API-Key/session
  // call) happened to trigger the run. Looked up by this fixed, well-known
  // email rather than an env-var-configured user id: there is nothing to
  // separately capture and set as a deployment secret, and the account
  // exists as soon as this already-mandatory db:seed-baseline step has run —
  // on both the Vercel and GCP deploy paths, and before any scheduled task
  // could ever fire. No password/api_key: this account never signs in or
  // calls the API as itself, only referenced by id for creator_id/
  // updater_id attribution. Seeded unconditionally (even when the schema
  // declares no x-scheduled-task entity) to keep this script schema-
  // agnostic, matching the admin/tenant bootstrap above.
  const scheduledTaskActorId = createId();
  await prisma.user.upsert({
    where: { email: SCHEDULED_TASK_ACTOR_EMAIL },
    update: {},
    create: {
      id: scheduledTaskActorId,
      creator_id: scheduledTaskActorId,
      updater_id: scheduledTaskActorId,
      email: SCHEDULED_TASK_ACTOR_EMAIL,
      name: 'Scheduled Task System',
    },
  });

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
  // boundary, not a bug — see docs/knowledge/seed-baseline-credential-hardening.md
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

  // ── Creator / Assignee roles ──────────────────────────────────────────────
  // Special item-scoped roles resolved by name in lib/authz.ts
  // (SPECIAL_ROLE_NAMES) — every user implicitly "has" whichever of these
  // applies to a given row (creator_id === userId / assignee_id === userId),
  // no explicit role assignment needed. `role.name` has no unique
  // constraint (see prisma/schema.prisma), so this uses the same
  // findFirst-then-create idiom as the Administrator role above rather
  // than an upsert.
  //
  // Creator gets exactly setting.read + setting.update and nothing else:
  // it is the mechanism by which a non-admin user reaches their own
  // /setting page (x-self-only filters the row set to creator_id ===
  // userId once this grant lets assertPermission('read'/'update') pass —
  // see lib/authz.ts's rows.length === 0 fallback, which denies everyone
  // but an Administrator when no permission row exists at all). Deliberately
  // NOT extended to any other entity — a broader "owners can manage their
  // own records" grant is a separate decision this seed does not make.
  //
  // Assignee is seeded with no permissions at all — a placeholder role for
  // future use, matching the existing getters.ts.jinja2 vocabulary without
  // granting anything today.
  let creatorRole = await prisma.role.findFirst({ where: { name: 'Creator' } });
  if (!creatorRole) {
    creatorRole = await prisma.role.create({
      data: {
        name: 'Creator',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.permission.upsert({
    where: { name_role_id: { name: 'setting', role_id: creatorRole.id } },
    update: { read: true, update: true },
    create: {
      name: 'setting',
      role_id: creatorRole.id,
      creator_id: admin.id,
      updater_id: admin.id,
      create: false,
      read: true,
      update: true,
      delete: false,
    },
  });

  let assigneeRole = await prisma.role.findFirst({ where: { name: 'Assignee' } });
  if (!assigneeRole) {
    assigneeRole = await prisma.role.create({
      data: {
        name: 'Assignee',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }

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
