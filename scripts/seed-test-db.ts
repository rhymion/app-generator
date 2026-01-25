// Script to seed test database
import { PrismaClient } from '@/app/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg'
import * as bcrypt from 'bcryptjs';

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
  
  const user1 = await prisma.users.upsert({
    where: { email: 'test@example.com' },
    update: {},
    create: {
      email: 'test@example.com',
      name: 'Test User',
      password: hashedPassword,
    },
  });

  const user2 = await prisma.users.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
      password: hashedPassword,
    },
  });

  // Create test books
  const book1 = await prisma.books.upsert({
    where: { id: 'test-book-1' },
    update: {},
    create: {
      id: 'test-book-1',
      title: 'Test Book 1',
      author: 'Test Author 1',
      price: 1500,
      publisher: 'Test Publisher',
      published: '2024-01-01',
      image: '/images/test-book-1.jpg',
    },
  });

  const book2 = await prisma.books.upsert({
    where: { id: 'test-book-2' },
    update: {},
    create: {
      id: 'test-book-2',
      title: 'Test Book 2',
      author: 'Test Author 2',
      price: 2000,
      publisher: 'Test Publisher',
      published: '2024-02-01',
      image: '/images/test-book-2.jpg',
    },
  });

  // Create test db_table
  const dbTable = await prisma.db_table.create({
    data: {
      name: 'test_table',
      description: 'Test table for e2e testing',
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
  console.log({ user1, user2, book1, book2, dbTable });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
