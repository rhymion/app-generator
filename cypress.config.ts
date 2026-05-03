import { defineConfig } from "cypress";
import { getGeneratedTasks } from "./cypress/support/generated-tasks";

export default defineConfig({
  e2e: {
    baseUrl: `http://localhost:${process.env.PORT || 3000}`,
    setupNodeEvents(on, config) {
      // Load test environment variables. Use dotenv-expand so ${VAR}
      // references in .env.test (e.g. DATABASE_URL referencing POSTGRES_PORT)
      // get resolved — plain dotenv does not expand them.
      const dotenvResult = require('dotenv').config({ path: '.env.test' });
      require('dotenv-expand').expand(dotenvResult);
      config.defaultCommandTimeout = 10000; // Increase default command timeout to 10 seconds

      // Task to reset and seed database before tests
      on('task', {
        async 'db:reset'() {
          const { resetTestDatabase } = require('./cypress/support/db-helpers');
          await resetTestDatabase();
          return null;
        },
        async 'db:seed'() {
          const { seedTestDatabase } = require('./cypress/support/db-helpers');
          await seedTestDatabase();
          return null;
        },
        async 'db:createLimitedApiUser'(modelName: string) {
          const { createLimitedApiUser } = require('./cypress/support/db-helpers');
          return await createLimitedApiUser(modelName);
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
