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

      // Task to reset and seed database before tests
      on('task', {
        async 'db:reset'() {
          const { resetTestDatabase } = require('./cypress/support/db-helpers');
          await resetTestDatabase();
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
        ...getGeneratedTasks(),
        async 'db:seedReservationInventory'(params: { quantity: number }) {
          const { seedReservationInventory } = require('./cypress/support/purchase_order/reservation_helper');
          return await seedReservationInventory(params.quantity);
        },
        async 'db:getInventoryAllocation'(params: { purchase_order_id: string }) {
          const { getInventoryAllocation } = require('./cypress/support/purchase_order/reservation_helper');
          return await getInventoryAllocation(params.purchase_order_id);
        },
      });

      return config;
    },
    retries: { runMode: 1, openMode: 0 },
    scrollBehavior: 'center',
    video: false,
    allowCypressEnv: false,
  },
});
