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
  console.log('Seeding ITS database...');

  const hashedPassword = await bcrypt.hash('password123', 10);

  // ── Users ─────────────────────────────────────────────────────────────────
  // admin@example.com is created by db:seed-tenant (scripts/seed-tenant.ts).
  // Run db:seed-tenant before db:seed.
  const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@example.com' } });

  const workerId = createId();
  const worker = await prisma.user.upsert({
    where: { email: 'worker@example.com' },
    update: {},
    create: {
      id: workerId,
      creator_id: workerId,
      updater_id: workerId,
      email: 'worker@example.com',
      name: 'Test Worker',
      password: hashedPassword,
    },
  });

  // ── Roles ──────────────────────────────────────────────────────────────────
  // Idempotency: role.name（アプリレベル。schema に @@unique なし）
  // Method: findFirst → create（upsert は @@unique が必要なため不使用）
  let adminRole = await prisma.role.findFirst({ where: { name: 'Administrator' } });
  if (!adminRole) {
    adminRole = await prisma.role.create({
      data: {
        name: 'Administrator',
        description: '管理者権限',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  // always connect（Prisma connect on existing relation is a no-op）
  await prisma.role.update({
    where: { id: adminRole.id },
    data: { users: { connect: { id: admin.id } } },
  });

  let creatorRole = await prisma.role.findFirst({ where: { name: 'Creator' } });
  if (!creatorRole) {
    creatorRole = await prisma.role.create({
      data: {
        name: 'Creator',
        description: 'レコード作成者',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.role.update({
    where: { id: creatorRole.id },
    data: { users: { connect: { id: admin.id } } },
  });

  let assigneeRole = await prisma.role.findFirst({ where: { name: 'Assignee' } });
  if (!assigneeRole) {
    assigneeRole = await prisma.role.create({
      data: {
        name: 'Assignee',
        description: '担当者',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.role.update({
    where: { id: assigneeRole.id },
    data: { users: { connect: { id: worker.id } } },
  });

  // ── Permissions ────────────────────────────────────────────────────────────
  const entities = ['user', 'role', 'organization', 'permission', 'setting'];

  // Administrator: full CRUD
  // Idempotency: @@unique([name, role_id])（DB制約あり）
  // Method: upsert（role_id 非null の場合のみ使用可）
  await Promise.all(entities.map(entity =>
    prisma.permission.upsert({
      where: { name_role_id: { name: entity, role_id: adminRole.id } },
      update: {},
      create: {
        name: entity,
        role_id: adminRole.id,
        creator_id: admin.id,
        updater_id: admin.id,
        create: true,
        read: true,
        update: true,
        delete: true,
      },
    })
  ));

  // Global (no role): read-only
  // Idempotency: name + role_id IS NULL（アプリレベル。Prisma型制約 + PostgreSQL NULL重複許容のため upsert 不可）
  // Method: findFirst({ where: { name, role_id: null } }) → create
  for (const entity of entities) {
    const existing = await prisma.permission.findFirst({
      where: { name: entity, role_id: null },
    });
    if (!existing) {
      await prisma.permission.create({
        data: {
          name: entity,
          creator_id: admin.id,
          updater_id: admin.id,
          create: false,
          read: true,
          update: false,
          delete: false,
        },
      });
    }
  }

  // // Creator role: create + read + update on ITS entities
  // const itsEntities = ['epic', 'feature', 'user_story', 'bug'];
  // // Administrator: full CRUD
  // await Promise.all(itsEntities.map(entity =>
  //   prisma.permission.create({
  //     data: {
  //       name: entity,
  //       role_id: adminRole.id,
  //       creator_id: admin.id,
  //       updater_id: admin.id,
  //       create: true,
  //       read: true,
  //       update: true,
  //       delete: true,
  //     },
  //   })
  // ));

  // // Global (no role): read-only
  // await Promise.all(itsEntities.map(entity =>
  //   prisma.permission.create({
  //     data: {
  //       name: entity,
  //       creator_id: admin.id,
  //       updater_id: admin.id,
  //       create: true,
  //       read: true,
  //       update: true,
  //       delete: true,
  //     },
  //   })
  // ));

  // // Assignee role: read + update on ITS entities
  // await Promise.all(itsEntities.map(entity =>
  //   prisma.permission.create({
  //     data: {
  //       name: entity,
  //       role_id: assigneeRole.id,
  //       creator_id: admin.id,
  //       updater_id: admin.id,
  //       create: false,
  //       read: true,
  //       update: true,
  //       delete: false,
  //     },
  //   })
  // ));

  // Creator: read/update setting (own account)
  // Idempotency: @@unique([name, role_id])（DB制約あり）
  // Method: upsert（role_id 非null の場合のみ使用可）
  await prisma.permission.upsert({
    where: { name_role_id: { name: 'setting', role_id: creatorRole.id } },
    update: {},
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

  // ── Organizations ──────────────────────────────────────────────────────────
  // Idempotency: organization.name（アプリレベル）
  // Method: findFirst → create + 後段 connect（Prisma connect on existing relation is a no-op）
  let devOrg = await prisma.organization.findFirst({ where: { name: 'Development devision' } });
  if (!devOrg) {
    devOrg = await prisma.organization.create({
      data: {
        name: 'Development devision',
        description: '',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.organization.update({
    where: { id: devOrg.id },
    data: { users: { connect: [{ id: admin.id }, { id: worker.id }] } },
  });

  let mgmtOrg = await prisma.organization.findFirst({ where: { name: 'Management team' } });
  if (!mgmtOrg) {
    mgmtOrg = await prisma.organization.create({
      data: {
        name: 'Management team',
        description: '',
        creator_id: admin.id,
        updater_id: admin.id,
      },
    });
  }
  await prisma.organization.update({
    where: { id: mgmtOrg.id },
    data: { users: { connect: { id: admin.id } } },
  });


  console.log('Database seeded successfully!');
  console.log({ admin, worker, adminRole, creatorRole, assigneeRole, devOrg });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
