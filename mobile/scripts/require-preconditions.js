// Fails closed unless the mobile Playwright preconditions are declared ready.
// Used by `npm run test:e2e:mobile:pw:raw`; mobile/playwright.config.ts applies the same check to
// any other way of starting Playwright with this config.
if (process.env.MOBILE_PW_PRECONDITIONS_READY !== '1') {
  console.error(
    'The mobile Playwright specs need a prepared stack: the right schema, a seeded and granted ' +
      'administrator, and TEST_EMAIL / TEST_PASSWORD.\n' +
      'Run `npm run test:e2e:mobile:pw` (scripts/run_mobile_entity_playwright.sh), which prepares all of it.\n' +
      'If you prepared the stack by hand as docs/knowledge/mobile-app.md describes, set MOBILE_PW_PRECONDITIONS_READY=1.',
  );
  process.exit(1);
}
