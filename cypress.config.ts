import { loadEnvConfig } from '@next/env'
loadEnvConfig(process.cwd(), false);

const port = process.env.PORT;
if (!port) {
  throw new Error('[cypress.config] PORT not set. Ensure .env.test defines PORT and NODE_ENV=test is set.');
}

import { defineConfig } from "cypress";
import { getGeneratedTasks } from "./cypress/support/generated-tasks";

export default defineConfig({
  e2e: {
    baseUrl: `http://localhost:${port}`,
    setupNodeEvents(on, config) {
      config.defaultCommandTimeout = 10000; // Increase default command timeout to 10 seconds

      // Load project-specific task registrations if present.
      // prj:sync copies prj/cypress/support/project-tasks.ts here.
      // Falls back to empty object when no project-tasks.ts exists (base template).
      let projectTasks: Record<string, (...args: any[]) => any> = {};
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('./cypress/support/project-tasks') as {
          getProjectTasks?: () => Record<string, (...args: any[]) => any>;
        };
        if (typeof mod.getProjectTasks === 'function') {
          projectTasks = mod.getProjectTasks();
        }
      } catch {
        // No project-specific tasks file — base generator default
      }

      // Task to reset and seed database before tests
      on('task', {
        async 'db:reset'() {
          const { resetTestDatabase, prisma } = require('./cypress/support/db-helpers');
          await resetTestDatabase();
          // Ensure search extensions exist after reset
          await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
          // Phase 1.2: re-seat the bootstrap tenant after the wipe so the
          // NOT NULL user.tenant_id constraint is satisfiable in subsequent
          // seeding. Removed when ticket 3.5 folds this into the generated
          // db-helpers.
          const { ensureDefaultTenant } = require('./cypress/support/_tenant');
          await ensureDefaultTenant();
          return null;
        },
        async 'db:seed'() {
          const { seedTestDatabase } = require('./cypress/support/db-helpers');
          await seedTestDatabase();
          return null;
        },
        async 'db:grantAllPermissions'() {
          const { grantAllEntityPermissions } = require('./cypress/support/db-helpers');
          await grantAllEntityPermissions();
          return null;
        },
        async 'db:createLimitedApiUser'(modelName: string) {
          const { createLimitedApiUser } = require('./cypress/support/db-helpers');
          return await createLimitedApiUser(modelName);
        },
        // cmd_328 batch2: session-loginable actor with a custom permission set, for
        // testing session-based routes (CSV import/export) that createLimitedApiUser
        // (X-API-Key only, unusable password) cannot reach.
        async 'db:createSessionUserWithPermission'(params: {
          entityName: string;
          flags: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean };
          label?: string;
        }) {
          const { createSessionUserWithPermission } = require('./cypress/support/db-helpers');
          return await createSessionUserWithPermission(params.entityName, params.flags, params.label);
        },
        // cmd_452: X-API-Key-bearing actor with a custom permission set, NOT
        // enrolled in any organization — the org-isolation IDOR fixture for
        // API-route tests (detail GET/PUT/DELETE, list, export).
        async 'db:createApiUserWithPermission'(params: {
          entityName: string;
          flags: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean };
          label?: string;
        }) {
          const { createApiUserWithPermission } = require('./cypress/support/db-helpers');
          return await createApiUserWithPermission(params.entityName, params.flags, params.label);
        },
        async 'db:seedMfaUser'() {
          const { seedMfaTestUser } = require('./cypress/support/mfa-helpers');
          return await seedMfaTestUser();
        },
        async 'generateTotp'(secret: string) {
          const otplib = require('otplib');
          return otplib.generateSync({ secret });
        },
        async 'db:createTestComment'() {
          const { prisma } = require('./cypress/support/db-helpers');
          const { TEST_CREDENTIALS } = require('./cypress/support/test-credentials');
          const { createId } = require('@paralleldrive/cuid2');
          const testUser = await prisma.user.findUnique({
            where: { email: TEST_CREDENTIALS.email },
          });
          if (!testUser) throw new Error('Test user not found. Run db:seed first.');
          const commentable = await prisma.commentable.create({ data: {} });
          const comment = await prisma.comment.create({
            data: {
              message: 'Test comment for reaction e2e',
              commentable_id: commentable.id,
              creator_id: testUser.id,
            },
          });
          return JSON.parse(JSON.stringify({ commentId: comment.id, userId: testUser.id }));
        },
        async 'db:createUserWithName'(params: { name: string; image?: string | null }) {
          // Creates a user row with a caller-chosen (possibly duplicate) name,
          // owned by the session test user. Used by CSV import tests to set up
          // natural-key match scenarios (cmd_328).
          const { prisma } = require('./cypress/support/db-helpers');
          const { TEST_CREDENTIALS } = require('./cypress/support/test-credentials');
          const { createId } = require('@paralleldrive/cuid2');
          const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
          if (!testUser) throw new Error('Test user not found. Run db:seed first.');
          const newUserId = createId();
          const record = await prisma.user.create({
            data: {
              id: newUserId,
              creator_id: testUser.id,
              updater_id: testUser.id,
              email: `${newUserId}@example.com`,
              name: params.name,
              image: params.image ?? null,
              password: 'not_needed',
            },
          });
          return JSON.parse(JSON.stringify(record));
        },
        // subtask_421f (cmd_421 Batch4): resource/product attachment
        // view/edit-boundary + permission + org-scope regression spec.
        async 'db:addUserToOrganizationByEmail'(params: { email: string; organizationId: string }) {
          const { addUserToOrganizationByEmail } = require('./cypress/support/attachment/helper');
          await addUserToOrganizationByEmail(params.email, params.organizationId);
          return null;
        },
        async 'db:getAttachableAttachments'(params: { attachableId: string }) {
          const { getAttachableAttachments } = require('./cypress/support/attachment/helper');
          return await getAttachableAttachments(params.attachableId);
        },
        async 'db:seedAttachment'(params: { attachableId: string; type: number; name: string; path: string; order?: number }) {
          const { seedAttachment } = require('./cypress/support/attachment/helper');
          return await seedAttachment(params);
        },
        async 'db:grantAdditionalEntityPermission'(params: { email: string; entityName: string; flags: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; import?: boolean } }) {
          const { grantAdditionalEntityPermission } = require('./cypress/support/attachment/helper');
          await grantAdditionalEntityPermission(params.email, params.entityName, params.flags);
          return null;
        },
        async 'db:createSecondUser'() {
          const { prisma } = require('./cypress/support/db-helpers');
          const { createId } = require('@paralleldrive/cuid2');
          const user2Id = createId();
          const user2ApiKey = 'test_mk_user2_00000000000000000000000000000000000000000000000000000000000';
          await prisma.user.create({
            data: {
              id: user2Id,
              creator_id: user2Id,
              updater_id: user2Id,
              email: 'testuser2_reaction@example.com',
              name: 'Test User 2',
              password: 'not_needed',
              api_key: user2ApiKey,
            },
          });
          return user2ApiKey;
        },
        async 'db:deleteTestComment'(commentId: string) {
          const { prisma } = require('./cypress/support/db-helpers');
          await prisma.comment.delete({ where: { id: commentId } });
          return null;
        },
        async 'db:populateOrganizationWithUser'(length: number) {
          // Creates organizations and enrolls the test user as a member.
          // Required for searchAssociatedOrganizationOptions which filters by user membership.
          const { prisma } = require('./cypress/support/db-helpers');
          const { TEST_CREDENTIALS } = require('./cypress/support/test-credentials');
          const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
          if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
          const records = [];
          for (let i = 1; i <= length; i++) {
            const record = await prisma.organization.create({
              data: {
                name: `Organization ${i}`,
                creator_id: testUser.id,
                updater_id: testUser.id,
                users: { connect: [{ id: testUser.id }] },
              },
            });
            records.push(record);
          }
          return JSON.parse(JSON.stringify(records));
        },
        async 'db:createOrganizationJa'(params: { name: string }) {
          // Creates a Japanese-named organization enrolled by the test user (for Japanese text search tests).
          const { prisma } = require('./cypress/support/db-helpers');
          const { TEST_CREDENTIALS } = require('./cypress/support/test-credentials');
          const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
          if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
          const record = await prisma.organization.create({
            data: {
              name: params.name,
              creator_id: testUser.id,
              updater_id: testUser.id,
              users: { connect: [{ id: testUser.id }] },
            },
          });
          return JSON.parse(JSON.stringify(record));
        },
        async 'db:createCreatorOnlyRoleUser'() {
          // Creates a user with only a 'Creator' special role for 'role' model (no general read).
          // Also creates one role owned by this user for search isolation testing.
          const { prisma } = require('./cypress/support/db-helpers');
          const { TEST_CREDENTIALS } = require('./cypress/support/test-credentials');
          const { createId } = require('@paralleldrive/cuid2');
          const testUser = await prisma.user.findUnique({ where: { email: TEST_CREDENTIALS.email } });
          if (!testUser) throw new Error('Test user not found. Make sure db:seed has run first.');
          const creatorUserId = createId();
          const creatorApiKey = 'test_mk_creator_only_role_000000000000000000000000000000000000000';
          // Create the 'Creator' special role (role name must be exactly 'Creator')
          const creatorRole = await prisma.role.create({
            data: {
              name: 'Creator',
              creator_id: testUser.id,
              updater_id: testUser.id,
            },
          });
          // Grant creator.read for 'role' model via the Creator role
          await prisma.permission.create({
            data: {
              name: 'role',
              role_id: creatorRole.id,
              create: true,
              read: true,
              update: true,
              delete: true,
              creator_id: testUser.id,
              updater_id: testUser.id,
            },
          });
          // Create the creator-only user
          await prisma.user.create({
            data: {
              id: creatorUserId,
              creator_id: creatorUserId,
              updater_id: creatorUserId,
              email: 'creator_only_role_search@example.com',
              name: 'Creator Only User (Search Test)',
              password: 'not_needed',
              api_key: creatorApiKey,
              roles: { connect: [{ id: creatorRole.id }] },
            },
          });
          // Create a role owned by this creator-only user (name contains 'Role' for search match)
          const ownedRole = await prisma.role.create({
            data: {
              name: 'RoleOwnedByCreatorUser',
              description: 'Role for creator-only search isolation test',
              creator_id: creatorUserId,
              updater_id: creatorUserId,
            },
          });
          return JSON.parse(JSON.stringify({ apiKey: creatorApiKey, ownedRoleId: ownedRole.id }));
        },
        ...getGeneratedTasks(),
        async 'db:getApprovableById'(params: { approvable_id: string }) {
          const { getApprovableById } = require('./cypress/support/approval_test_helpers');
          return await getApprovableById(params.approvable_id);
        },
        async 'db:getPendingApprovalRequest'(params: { approvable_id: string }) {
          const { getPendingApprovalRequest } = require('./cypress/support/approval_test_helpers');
          return await getPendingApprovalRequest(params.approvable_id);
        },
        async 'db:populateAuditLog'(length: number) {
          const { populateAuditLogData } = require('./cypress/support/audit_log/helper');
          return await populateAuditLogData(length);
        },
        async 'db:populateAuditLogFull'(length: number) {
          const { populateAuditLogFullData } = require('./cypress/support/audit_log/helper');
          return await populateAuditLogFullData(length);
        },
        async 'db:createAuditLogWithMetadata'(params: { actorUserId: string; metadata: Record<string, unknown> }) {
          const { prisma } = require('./cypress/support/db-helpers');
          const row = await prisma.audit_log.create({
            data: { action: 'test_action', actor_user_id: params.actorUserId, metadata: params.metadata },
          });
          return JSON.parse(JSON.stringify(row));
        },
        async 'db:getAuditLogByActor'(actorUserId: string) {
          const { prisma } = require('./cypress/support/db-helpers');
          const rows = await prisma.audit_log.findMany({ where: { actor_user_id: actorUserId } });
          return JSON.parse(JSON.stringify(rows));
        },
        async 'db:getAuditLogById'(rowId: string) {
          const { prisma } = require('./cypress/support/db-helpers');
          const row = await prisma.audit_log.findUnique({ where: { id: rowId } });
          return JSON.parse(JSON.stringify(row));
        },
        async 'compliance:anonymizeUser'(userId: string) {
          // Calls anonymizeUser directly in the Node.js task process (bypasses HTTP server),
          // ensuring tests run against the current source file, not the compiled bundle.
          const { anonymizeUser } = require('./lib/compliance/anonymize_user');
          const result = await anonymizeUser(userId);
          return JSON.parse(JSON.stringify(result));
        },
        ...projectTasks,
      });

      return config;
    },
    retries: { runMode: 1, openMode: 0 },
    scrollBehavior: 'center',
    video: false,
    allowCypressEnv: false,
  },
});
