import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    setupNodeEvents(on, config) {
      // Load test environment variables
      require('dotenv').config({ path: '.env.test' });
      
      // Task to reset database before tests
      on('task', {
        async 'db:reset'() {
          const { execSync } = require('child_process');
          execSync('npm run db:reset:test', { stdio: 'inherit' });
          return null;
        },
        async 'db:seed'() {
          // Optional: Add seeding logic here
          return null;
        }
      });
      
      return config;
    },
    video: false,
  },
});
