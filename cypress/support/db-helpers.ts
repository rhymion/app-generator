import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';
import { TEST_CREDENTIALS, getTestPasswordHash } from './test-credentials';

// Use direct database connection for tests
// Accelerate extension is required but will use direct connection for non-Accelerate URLs
const connectionString = `${process.env.DATABASE_URL}`;

const adapter = new PrismaPg(
  { connectionString },
);

const prisma = new PrismaClient({ adapter })
// const prisma = new PrismaClient({
//   accelerateUrl: process.env.DATABASE_URL || '',
// }).$extends(withAccelerate());

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

export { prisma };
