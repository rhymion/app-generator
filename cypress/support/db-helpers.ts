import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client';
import { TEST_CREDENTIALS, getTestPasswordHash } from './test-credentials';
// import prisma from '@/lib/prisma';

// Use direct database connection for tests
// Accelerate extension is required but will use direct connection for non-Accelerate URLs
const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg(
  { connectionString },
);

const prisma = new PrismaClient({ adapter })

/**
 * Reset test database to clean state
 */
export async function resetTestDatabase() {
  // Delete all records in reverse order (to respect foreign keys)
  await prisma.yyyyy_yyyyy.deleteMany();
  await prisma.xxxxx_xxxxx.deleteMany();
  await prisma.field.deleteMany();
  await prisma.db_table.deleteMany();
  await prisma.reviews.deleteMany();
  await prisma.books.deleteMany();
  await prisma.users.deleteMany();
}

/**
 * Seed test database with minimal data
 */
export async function seedTestDatabase() {
  // Hash password - consistent across all environments
  const hashedPassword = await getTestPasswordHash();
  
  // Create test user
  const user = await prisma.users.create({
    data: {
      email: TEST_CREDENTIALS.email,
      name: TEST_CREDENTIALS.name,
      password: hashedPassword,
    },
  });

  // Create test book
  const book = await prisma.books.create({
    data: {
      title: 'Test Book',
      author: 'Test Author',
      price: 1000,
      publisher: 'Test Publisher',
      published: '2024-01-01',
      image: '/test-image.jpg',
    },
  });

  return { user, book };
}

export async function populateXxxxxXxxxxData(length: number) {
  // Create sample Xxxxx Xxxxx records
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.xxxxx_xxxxx.create({
      data: {
        name: `Xxxxx Xxxxx ${i}`,
        description: `Description for Xxxxx Xxxxx ${i}`,
      },
    });
    records.push(record);
  }
  return records;
}

export async function populateYyyyyYyyyyData(xxxxxXxxxxId: string, length: number) {
  // Create sample Yyyyy Yyyyy records linked to given Xxxxx Xxxxx ID
  const records = [];
  for (let i = 1; i <= length; i++) {
    const record = await prisma.yyyyy_yyyyy.create({
      data: {
        xxxxx_xxxxx_id: xxxxxXxxxxId,
        name: `Yyyyy Yyyyy ${i}`,
        type: 'string',
        max_length: 255,
        max: 65535,
        regex: "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
        required: i % 2 === 0,
        written_by: 'Seeder Script',
      },
    });
    records.push(record);
  }
  return records;
}

export { prisma };
