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
          const { totp } = require('otplib');
          return totp.generate(secret);
        },
        ...getGeneratedTasks(),
      });

      return config;
    },
    scrollBehavior: 'center',
    video: false,
    allowCypressEnv: false,
  },
});
