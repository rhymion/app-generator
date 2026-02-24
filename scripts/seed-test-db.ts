// Script to seed test database
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';
import { createId } from "@paralleldrive/cuid2";

// Use direct database connection for seeding
// Accelerate extension is required but will use direct connection for non-Accelerate URLs
const connectionString = `${process.env.DATABASE_URL}`;
const adapter = new PrismaPg(
  { connectionString },
);
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding test database...');

  // Create test users
  const hashedPassword = await bcrypt.hash('password123', 10);
  const userId = createId();
  const user1 = await prisma.user_account.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      id: userId,
      creator_id: userId,
      updater_id: userId,
      email: 'test@example.com',
      name: 'Test User',
      password: hashedPassword,
    },
  });

  const user2 = await prisma.user_account.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      creator_id: userId,
      updater_id: userId,
      email: 'admin@example.com',
      name: 'Admin User',
      password: hashedPassword,
    },
  });

  // Create test db_table
  const dbTable = await prisma.db_table.create({
    data: {
      name: 'test_table',
      description: 'Test table for e2e testing',
      creator_id: user1.id,
      updater_id: user1.id,
      fields: {
        create: [
          {
            name: 'test_field_1',
            type: 'string',
            max_length: 100,
            required: true,
          },
          {
            name: 'test_field_2',
            type: 'number',
            max: 999,
            required: false,
          },
        ],
      },
    },
  });

  const role = await prisma.role.create({
    data: {
      name: 'Admin',
      description: 'Admin role with all permissions',
      creator_id: user2.id,
      updater_id: user2.id,
      user_accounts: {
        connect: { id: user2.id },
      },
    },
  });

  const entities = ['db_table', 'xxxxx_xxxxx', 'parent_only', 'parent1', 'user_account', 'role', 'organization', 'permission', 'procedure', 'resource', 'booking'];
  const admin_permissions = await Promise.all(entities.map(async function(entity) {
    return await prisma.permission.create({
      data: {
        name: entity,
        role_id: role.id,
        creator_id: user2.id,
        updater_id: user2.id,
        create: true,
        read: true,
        update: true,
        delete: true,
      },
    });
  })); 

  const no_role_permissions = await Promise.all(entities.map(async function(entity) {
    return await prisma.permission.create({
      data: {
        name: entity,
        creator_id: user2.id,
        updater_id: user2.id,
        create: false,
        read: true,
        update: false,
        delete: false,
      },
    });
  }));

  const organization1 = await prisma.organization.create({
    data: {
      name: 'Test Organization 1',
      description: 'Organization for testing',
      creator_id: user2.id,
      updater_id: user2.id,
      user_accounts: {
        connect: [{ id: user1.id }, { id: user2.id }],
      },
    },
  });

  const organization2 = await prisma.organization.create({
    data: {
      name: 'Test Organization 2',
      description: 'Organization for testing',
      creator_id: user2.id,
      updater_id: user2.id,
      user_accounts: {
        connect: { id: user1.id },
      },
    },
  });

  const organization3 = await prisma.organization.create({
    data: {
      name: 'Test Organization 3',
      description: 'Organization for testing',
      creator_id: user2.id,
      updater_id: user2.id,
      user_accounts: {
        connect: { id: user2.id },
      },
    },
  });

  console.log('Test database seeded successfully!');
  console.log({ user1, user2, dbTable, role, admin_permissions, no_role_permissions, organization1, organization2, organization3 });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
