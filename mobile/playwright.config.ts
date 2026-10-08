import { defineConfig } from '@playwright/test';

// Run with `npm run test:e2e:mobile:pw` from the repository root.
//
// No webServer is configured on purpose: the stack is three processes (the
// Next.js API, the Expo web dev server and the same-origin proxy that joins
// them) and Metro start-up time and port conflicts make auto-starting them
// per run unreliable. Start them explicitly on ports you pick, then point
// EXPO_WEB_URL at the proxy port. See docs/knowledge/mobile-app.md.
export default defineConfig({
  testDir: './e2e',
  // scripts/run_mobile_entity_playwright.sh splits the suite: entity-crud.spec.ts needs the
  // fixture entities, the other specs assume the default schema.
  testIgnore: process.env.MOBILE_PW_IGNORE || undefined,
  use: {
    baseURL: process.env.EXPO_WEB_URL ?? 'http://localhost:8081',
  },
  timeout: 60000,
});
