import { defineConfig } from '@playwright/test';

// Run with `npm run test:e2e:mobile:pw` from the repository root: that runs
// scripts/run_mobile_entity_playwright.sh, which builds a disposable stack with the schema each
// spec set needs. This config refuses to run unless that script (or a developer who prepared the
// same preconditions by hand, see docs/knowledge/mobile-app.md) has set the marker below, so a bare
// invocation against the wrong schema does not read as a hundred regressions.
//
// No webServer is configured on purpose: the stack is three processes (the
// Next.js API, the Expo web dev server and the same-origin proxy that joins
// them) and Metro start-up time and port conflicts make auto-starting them
// per run unreliable. Start them explicitly on ports you pick, then point
// EXPO_WEB_URL at the proxy port. See docs/knowledge/mobile-app.md.
if (process.env.MOBILE_PW_PRECONDITIONS_READY !== '1') {
  throw new Error(
    'The mobile Playwright specs need a prepared stack: the right schema, a seeded and granted ' +
      'administrator, and TEST_EMAIL / TEST_PASSWORD. Run `npm run test:e2e:mobile:pw` ' +
      '(scripts/run_mobile_entity_playwright.sh), which prepares all of it. If you prepared the stack ' +
      'by hand as docs/knowledge/mobile-app.md describes, set MOBILE_PW_PRECONDITIONS_READY=1.',
  );
}

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
