// AUTO-GENERATED - DO NOT EDIT (hand-edited sections: grantAllEntityPermissions, createLimitedApiUser, createSessionUserWithPermission, createApiUserWithPermission, createCrossOrgScenario)
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

  // Level 1: audit_log, mfa_recovery_code
  await prisma.audit_log.deleteMany();
  await prisma.mfa_recovery_code.deleteMany();

  // Level 2: approval_request, attachment, dashboard_widget, notification, organization, permission, personal_note, reaction
  await prisma.approval_request.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.dashboard_widget.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.personal_note.deleteMany();
  await prisma.reaction.deleteMany();

  // Level 3: approvable, approval_flow, attachable, comment, dashboard
  await prisma.approvable.deleteMany();
  await prisma.approval_flow.deleteMany();
  await prisma.attachable.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.dashboard.deleteMany();

  // Level 4: commentable, role
  await prisma.commentable.deleteMany();
  await prisma.role.deleteMany();

  // Level 5: user
  await prisma.user.deleteMany();

  // Clear in-process LRU caches (api-key, permission) on the running server.
  // Production builds keep these caches active across requests; after the
  // db delete above, the cached api_key → userId mapping would still point at
  // a deleted user_account row, causing the next write to fail with a
  // <model>_updater_id_fkey violation. The endpoint is gated by
  // TEST_RESET_TOKEN — only enabled in .env.test.
  //
  // Keyed off PORT, not NEXTAUTH_URL: PORT is what actually varies when a
  // caller overrides it to dodge a residual process on the default port
  // (e.g. `PORT=3001 npm run test:e2e:cy:api`). NEXTAUTH_URL stays pinned to
  // .env.test's default and does not track that override, so using it here
  // sends this call to a server that isn't listening — the fetch fails
  // silently (see catch below), the cache never clears, and a later request
  // resolves a stale/deleted userId, surfacing as a `<model>_x_id_fkey`
  // violation or a spurious 403 several tests later.
  const baseUrl = `http://localhost:${process.env.PORT ?? 3000}`;
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
  const user = await prisma.user.create({
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

export const ALL_ENTITIES = [
  'approval_flow',
  'dashboard',
  'organization',
  'permission',
  'personal_note',
  'role',
  'user',
];

/**
 * Grant the test user full CRUD permissions on every entity via an Administrator role.
 * Call after seedTestDatabase() for normal-flow tests that require access to CRUD pages.
 *
 * Required because authz.ts uses default-deny: a user with no permission records is
 * denied all operations. Only users with explicit grants (via a role) can access resources.
 */
export async function grantAllEntityPermissions(): Promise<void> {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Run db:seed first.');

  const adminRole = await prisma.role.create({
    data: {
      name: 'Administrator',
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await Promise.all(ALL_ENTITIES.map(entity =>
    prisma.permission.create({
      data: {
        name: entity,
        role_id: adminRole.id,
        create: true,
        read: true,
        update: true,
        delete: true,
        import: true,
        creator_id: testUser.id,
        updater_id: testUser.id,
      },
    })
  ));

  await prisma.user.update({
    where: { id: testUser.id },
    data: { roles: { connect: [{ id: adminRole.id }] } },
  });
}

/**
 * Create a limited API user with explicit deny permissions for a given model.
 * Returns the limited user's API key.
 *
 * How permission denial works (after default-deny change):
 * - Main test user has no roles → no permission records match → default-deny (all false)
 * - Limited user has a DenyRole with explicit false permissions → all operations denied → 403
 * createLimitedApiUser is used to test the explicit-deny path (role present but all false).
 */
export async function createLimitedApiUser(entityName: string): Promise<string> {
  const testUser = await prisma.user.findUnique({
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
      import: false,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.user.create({
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

/**
 * Create an API-key-bearing user with a custom permission set for a given model,
 * NOT enrolled in any organization. Needed for cmd_452 org-isolation X-API-Key
 * route tests (detail GET/PUT/DELETE, list, export): createLimitedApiUser only
 * covers the all-false explicit-deny case, and createSessionUserWithPermission
 * issues no api_key (session-only). This is the "has the RBAC role but is a
 * different org" IDOR fixture — analogous to attachment/helper.ts's
 * addUserToOrganizationByEmail, but deliberately the negative (non-member) case.
 */
export async function createApiUserWithPermission(
  entityName: string,
  flags: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean },
  label = 'custom',
): Promise<string> {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Run db:seed first.');

  const newUserId = createId();
  const apiKey = `test_mk_${label}_${entityName}_${newUserId}`;

  const customRole = await prisma.role.create({
    data: {
      name: `ApiRole_${label}_${entityName}_${newUserId}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.permission.create({
    data: {
      name: entityName,
      role_id: customRole.id,
      create: flags.create ?? false,
      read: flags.read ?? false,
      update: flags.update ?? false,
      delete: flags.delete ?? false,
      import: flags.import ?? false,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.user.create({
    data: {
      id: newUserId,
      creator_id: newUserId,
      updater_id: newUserId,
      email: `api_${label}_${entityName}@example.com`,
      name: `API User (${label}/${entityName})`,
      password: 'not_needed',
      api_key: apiKey,
      roles: { connect: [{ id: customRole.id }] },
    },
  });

  return apiKey;
}

/**
 * Create a session-loginable user with a custom permission set for a given model.
 * Needed for testing session-based routes (e.g. CSV import/export) where authz is
 * resolved from the session cookie via getSessionUserId(), not X-API-Key —
 * createLimitedApiUser's password ('not_needed') cannot pass the login form, so it
 * cannot be used for these routes.
 * The returned user always logs in with TEST_CREDENTIALS.password (same hash as the
 * main test user); only the email differs.
 */
export async function createSessionUserWithPermission(
  entityName: string,
  flags: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean },
  label = 'custom',
): Promise<string> {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Run db:seed first.');

  const hashedPassword = await getTestPasswordHash();
  const newUserId = createId();
  const email = `session_${label}_${entityName}@example.com`;

  const customRole = await prisma.role.create({
    data: {
      name: `SessionRole_${label}_${entityName}_${newUserId}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.permission.create({
    data: {
      name: entityName,
      role_id: customRole.id,
      create: flags.create ?? false,
      read: flags.read ?? false,
      update: flags.update ?? false,
      delete: flags.delete ?? false,
      import: flags.import ?? false,
      creator_id: testUser.id,
      updater_id: testUser.id,
    },
  });

  await prisma.user.create({
    data: {
      id: newUserId,
      creator_id: newUserId,
      updater_id: newUserId,
      email,
      name: `Session User (${label}/${entityName})`,
      password: hashedPassword,
      roles: { connect: [{ id: customRole.id }] },
    },
  });

  return email;
}

/**
 * Creates a cross-org test fixture for G3 (cmd_520 batch A): orgA (the main
 * test user, TEST_CREDENTIALS/TEST_API_KEY, IS a member of), orgB (the main
 * test user is NOT a member of), and — when entityId is supplied — reassigns
 * that existing  row into orgB.
 *
 * Deliberately generic across entities: rather than re-deriving each entity's
 * full FK/required-field construction logic here (already handled by that
 * entity's own db:populate<Entity> task), the caller creates the row first via
 * db:populate<Entity> and passes its id in — this helper's only entity-aware
 * step is a direct Prisma reassignment of that row's organization_id, which
 * every should_filter_by_org entity has by construction. Deliberately bypasses
 * the service layer's own org-membership validation (lib/<entity>/service.ts)
 * — constructing a "row belongs to an org the actor isn't a member of" fixture
 * is the whole point, so going around that validation for fixture setup is
 * correct, not a bug.
 */
export async function createCrossOrgScenario(
  entityName: string,
  entityId?: string,
): Promise<{ orgA: { id: string }; orgB: { id: string }; entityInOrgB?: { id: string } }> {
  const testUser = await prisma.user.findUnique({
    where: { email: TEST_CREDENTIALS.email },
  });
  if (!testUser) throw new Error('Test user not found. Run db:seed first.');

  const orgA = await prisma.organization.create({
    data: {
      name: `CrossOrgA_${entityName}_${createId()}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      users: { connect: [{ id: testUser.id }] },
    },
  });
  const orgB = await prisma.organization.create({
    data: {
      name: `CrossOrgB_${entityName}_${createId()}`,
      creator_id: testUser.id,
      updater_id: testUser.id,
      // Deliberately NOT connecting testUser — orgB is the "foreign" org.
    },
  });

  let entityInOrgB: { id: string } | undefined;
  if (entityId) {
    const updated = await (prisma as Record<string, any>)[entityName].update({
      where: { id: entityId },
      data: { organization_id: orgB.id },
    });
    entityInOrgB = { id: updated.id };
  }

  return JSON.parse(JSON.stringify({ orgA: { id: orgA.id }, orgB: { id: orgB.id }, entityInOrgB }));
}

export { prisma };
