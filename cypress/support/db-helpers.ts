// AUTO-GENERATED - DO NOT EDIT
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/app/generated/prisma/client';
import { TEST_CREDENTIALS, TEST_API_KEY, getTestPasswordHash } from './test-credentials';
import { createId } from "@paralleldrive/cuid2";

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

  // Level 1: approval_request, checkup_judgment, comment, lifestyle, medicine, organization, permission, symptom
  await prisma.approval_request.deleteMany();
  await prisma.checkup_judgment.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.lifestyle.deleteMany();
  await prisma.medicine.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.symptom.deleteMany();

  // Level 2: approvable, approval_flow, commentable, pre_check
  await prisma.approvable.deleteMany();
  await prisma.approval_flow.deleteMany();
  await prisma.commentable.deleteMany();
  await prisma.pre_check.deleteMany();

  // Level 3: checkup, role
  await prisma.checkup.deleteMany();
  await prisma.role.deleteMany();

  // Level 4: patient_rel
  await prisma.patient_rel.deleteMany();

  // Level 5: clinic, patient
  await prisma.clinic.deleteMany();
  await prisma.patient.deleteMany();

  // Level 6: user_account
  await prisma.user_account.deleteMany();

  // Clear in-process LRU caches (api-key, permission) on the running server.
  // Production builds keep these caches active across requests; after the
  // db delete above, the cached api_key → userId mapping would still point at
  // a deleted user_account row, causing the next write to fail with a
  // <model>_updater_id_fkey violation. The endpoint is gated by
  // TEST_RESET_TOKEN — only enabled in .env.test.
  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
  const token = process.env.TEST_RESET_TOKEN;
  if (token) {
    try {
      await fetch(`${baseUrl}/api/test-utils/reset-caches`, {
        method: 'POST',
        headers: { 'X-Test-Reset-Token': token },
      });
    } catch {
      // Server may not be reachable yet (e.g. start-server-and-test bootstrap).
      // The first test will still see a clean DB; cache survives until the
      // next reset succeeds. Not worth failing the suite over.
    }
  }
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
      updater_id: userId,
      email: TEST_CREDENTIALS.email,
      name: TEST_CREDENTIALS.name,
      password: hashedPassword,
      api_key: TEST_API_KEY,
    },
  });

  return { user };
}

/**
 * Create a limited API user with explicit deny permissions for a given model.
 * Returns the limited user's API key.
 *
 * How permission denial works:
 * - Main test user has no roles → no permission records match → default-grant (all true)
 * - Limited user has a DenyRole with explicit false permissions → all operations denied → 403
 */
export async function createLimitedApiUser(entityName: string): Promise<string> {
  const testUser = await prisma.user_account.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Run db:seed first.');

  const limitedApiKey = `test_mk_limited_${entityName}`;
  const limitedUserId = createId();

  const denyRole = await prisma.role.create({
    data: {
      name: `DenyRole_${entityName}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.permission.create({
    data: {
      name: entityName,
      role_id: denyRole.id,
      create: false,
      read: false,
      update: false,
      delete: false,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.user_account.create({
    data: {
      id: limitedUserId,
      creator_id: limitedUserId,
      updater_id: limitedUserId,
      email: `limited_${entityName}@example.com`,
      name: `Limited User (${entityName})`,
      password: 'not_needed',
      api_key: limitedApiKey,
      roles: { connect: [{ id: denyRole.id }] },
    },
  });

  return limitedApiKey;
}

export { prisma };
