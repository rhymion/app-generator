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

  // ── Admin user ────────────────────────────────────────────────────────────
  // Created here so db:seed-tenant is sufficient for tests requiring a
  // sign-in with admin@example.com. Future default permission of 'none'
  // means the admin must exist before general seeding adds any other data.
  const hashedPassword = await bcrypt.hash('password123', 10);
  const adminId = createId();
  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      id: adminId,
      creator_id: adminId,
      updater_id: adminId,
      api_key: 'mk_78d1e51a47f40912f5a1787367e3f7f6ed17c314590eac84edc5b3f785a527b1',
      email: 'admin@example.com',
      name: 'Test Admin',
      password: hashedPassword,
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
  // ── Default approval flow for leave_request ──────────────────
  // An approval_flow row must exist for notifications to fire.
  // Default: any user can submit leave requests (requestor_role_id: null),
  // and the seeded admin user holds the approver role.

  const leaveRequestApproverRole = (
    await prisma.role.findFirst({ where: { name: 'Leave Request Approver' } })
  ) ?? await prisma.role.create({
    data: {
      name: 'Leave Request Approver',
      description: 'Approves leave requests',
      creator_id: admin.id,
      updater_id: admin.id,
    },
  });

  const existingLeaveRequestFlow = await prisma.approval_flow.findFirst({
    where: { entity_name: 'leave_request' },
  });
  if (!existingLeaveRequestFlow) {
    await prisma.approval_flow.create({
      data: {
        entity_name: 'leave_request',
        requestor_role_id: null,         // any user can create leave requests
        approver_role_id: leaveRequestApproverRole.id,
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }

  // Give the admin user the approver role so notifications route to them
  await prisma.user.update({
    where: { id: admin.id },
    data: { roles: { connect: { id: leaveRequestApproverRole.id } } },
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
