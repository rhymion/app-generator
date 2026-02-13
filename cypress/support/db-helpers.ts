import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client';
import { TEST_CREDENTIALS, getTestPasswordHash } from './test-credentials';
import { createId } from "@paralleldrive/cuid2";

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
  // Delete all records in correct order to respect foreign key constraints
  // Delete child tables first, then parent tables

  // Level 1: Delete tables that reference parent1
  await prisma.parent1_child1.deleteMany();
  await prisma.parent1_child2.deleteMany();
  await prisma.parent1_list.deleteMany();

  // Level 2: Delete tables that reference xxxxx_xxxxx and db_table
  await prisma.yyyyy_yyyyy.deleteMany();
  await prisma.field.deleteMany();

  // Level 3: Delete tables that reference role and procedure (self-reference)
  await prisma.permission.deleteMany();
  await prisma.procedure.deleteMany();

  // Level 4: Delete tables that reference user_account (via creator_id)
  await prisma.parent1.deleteMany();
  await prisma.xxxxx_xxxxx.deleteMany();
  await prisma.db_table.deleteMany();
  await prisma.parent_only.deleteMany();
  await prisma.role.deleteMany();
  await prisma.organization.deleteMany();

  // Level 5: Finally delete user_account (last because everything references it)
  await prisma.user_account.deleteMany();
}

/**
 * Seed test database with minimal data
 */
export async function seedTestDatabase() {
  // Hash password - consistent across all environments
  const hashedPassword = await getTestPasswordHash();
  const userId = createId();
  // Create test user
  const user = await prisma.user_account.create({
    data: {
      id: userId,
      creator_id: userId,
      email: TEST_CREDENTIALS.email,
      name: TEST_CREDENTIALS.name,
      password: hashedPassword,
    },
  });

  return { user };
}

export { prisma };
