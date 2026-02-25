import { defineConfig } from "cypress";
import { getGeneratedTasks } from "./cypress/support/generated-tasks";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    setupNodeEvents(on, config) {
      // Load test environment variables
      require('dotenv').config({ path: '.env.test' });

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
        ...getGeneratedTasks(),
      });

      return config;
    },
    video: false,
  },
});
