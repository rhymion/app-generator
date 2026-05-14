// Script to seed ITS (Issue Tracking System) database with sample data
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';
import { createId } from "@paralleldrive/cuid2";

const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding ITS database...');

  const hashedPassword = await bcrypt.hash('password123', 10);

  // ── Users ─────────────────────────────────────────────────────────────────
  // Self-referential: create with own id as creator/updater
  const adminId = createId();
  const workerId = createId();

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
  const adminRole = await prisma.role.create({
    data: {
      name: 'Administrator',
      description: '管理者権限',
      creator_id: admin.id,
      updater_id: admin.id,
      users: { connect: { id: admin.id } },
    },
  });

  const creatorRole = await prisma.role.create({
    data: {
      name: 'Creator',
      description: 'レコード作成者',
      creator_id: admin.id,
      updater_id: admin.id,
      users: { connect: { id: admin.id } },
    },
  });

  const assigneeRole = await prisma.role.create({
    data: {
      name: 'Assignee',
      description: '担当者',
      creator_id: admin.id,
      updater_id: admin.id,
      users: { connect: { id: worker.id } },
    },
  });

  // ── Permissions ────────────────────────────────────────────────────────────
  const entities = ['user', 'role', 'organization', 'permission', 'setting'];

  // Administrator: full CRUD
  await Promise.all(entities.map(entity =>
    prisma.permission.create({
      data: {
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
  await Promise.all(entities.map(entity =>
    prisma.permission.create({
      data: {
        name: entity,
        creator_id: admin.id,
        updater_id: admin.id,
        create: false,
        read: true,
        update: false,
        delete: false,
      },
    })
  ));

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
  for (const role of [creatorRole]) {
    await prisma.permission.create({
      data: {
        name: 'setting',
        role_id: role.id,
        creator_id: admin.id,
        updater_id: admin.id,
        create: false,
        read: true,
        update: true,
        delete: false,
      },
    });
  }

  // ── Organizations ──────────────────────────────────────────────────────────
  const devOrg = await prisma.organization.create({
    data: {
      name: 'Development devision',
      description: '',
      creator_id: admin.id,
      updater_id: admin.id,
      users: { connect: [{ id: admin.id }, { id: worker.id }] },
    },
  });

  await prisma.organization.create({
    data: {
      name: 'Management team',
      description: '',
      creator_id: admin.id,
      updater_id: admin.id,
      users: { connect: { id: admin.id } },
    },
  });


  console.log('ITS database seeded successfully!');
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
