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

  console.log('Test database seeded successfully!');
  console.log({ user1, user2, dbTable });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
