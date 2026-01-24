import { PrismaClient } from '@/app/generated/prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

// Use direct database connection for tests
const prisma = new PrismaClient({
  accelerateUrl: process.env.DATABASE_URL || '',
}).$extends(withAccelerate());

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
  // Create test user
  const user = await prisma.users.create({
    data: {
      email: 'test@example.com',
      name: 'Test User',
      password: 'hashed_password_here',
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
