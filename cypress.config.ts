import { defineConfig } from "cypress";

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
        async 'db:populateXxxxxXxxxx'(length: number) {
          const { populateXxxxxXxxxxData } = require('./cypress/support/db-helpers');
          const records = await populateXxxxxXxxxxData(length);
          return records;
        },
        async 'db:populateYyyyyYyyyy'(params: { xxxxxXxxxxId: string; length?: number; Length?: number }) {
          const { populateYyyyyYyyyyData } = require('./cypress/support/db-helpers');
          const length = params.length || params.Length || 1;
          const records = await populateYyyyyYyyyyData(params.xxxxxXxxxxId, length);
          return records;
        }
      });
      
      return config;
    },
    video: false,
  },
});
