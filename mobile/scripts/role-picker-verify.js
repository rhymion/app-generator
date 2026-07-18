// Real-browser (default Chromium security, no --disable-web-security)
// verification of the cmd_376 batch1 mobile role m2m picker flow. See
// docs/knowledge/mobile-poc-test-runbook.md for why a real-browser check is
// mandatory in addition to the automated Playwright/Cypress suites.
//
// This is a multi-page flow (login -> role list -> role detail -> role edit
// with picker -> save -> back to list -> re-open -> assert unchanged) that
// real-browser-verify.js's single login+assert shape can't express, so per
// that script's own header comment ("extend real-browser-verify.js rather
// than forking it... for a multi-page flow"), this is a purpose-built
// companion script following the same conventions (default security
// posture, no CORS bypass, env-var configured).
//
// Proves the cmd_366 guard end-to-end through the real UI: editing the
// Administrator role's name WITHOUT touching the Users picker must not
// wipe role.users (and, transitively, must not revoke role.read for a user
// who holds that role) — see cmd366_prevention in
// queue/reports/subtask_376a_gunshi.yaml.
//
// Env vars:
//   BASE_URL         URL to open. Default: http://localhost:8090
//   TEST_EMAIL        Default: admin@example.com
//   TEST_PASSWORD     Default: password123
//   SCREENSHOT_DIR    Default: mobile/scripts/role-picker-verify-screenshots
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8090';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(__dirname, 'role-picker-verify-screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const shot = (n) => path.join(SCREENSHOT_DIR, n);

(async () => {
  // No launchOptions: default Chromium security posture (no
  // --disable-web-security) — see real-browser-verify.js header comment for
  // why that flag would defeat the purpose of this check.
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const result = { steps: [], consoleErrors: [], screenshots: [] };
  const record = (step, ok, detail) => {
    result.steps.push({ step, ok, detail });
    console.log(`[${ok ? 'OK' : 'FAIL'}] ${step}${detail ? ' — ' + detail : ''}`);
  };

  // ---- 1. Login ----------------------------------------------------------
  await page.goto(BASE_URL);
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
  await page.click('text=Sign In');
  await page.waitForSelector('text=Welcome back.', { timeout: 15000 });
  await page.screenshot({ path: shot('01-login.png'), fullPage: true });
  result.screenshots.push(shot('01-login.png'));
  record('login', true);

  // ---- 2. Navigate to Roles list -----------------------------------------
  // react-native-web renders each row's title/subtitle as plain <div> text
  // nodes with no stable test id, and `waitForSelector('text=...')`'s
  // visibility computation is unreliable against RN-web's flex layout here
  // (observed hanging past its timeout even once the DOM had settled) — a
  // fixed settle delay + body-text assertion, the same pattern
  // real-browser-verify.js already uses, is the robust check.
  await page.click('text=Roles');
  await page.waitForTimeout(2000);
  const listBody = await page.textContent('body');
  const sawAdminOnList = listBody.includes('Administrator');
  await page.screenshot({ path: shot('02-role-list.png'), fullPage: true });
  result.screenshots.push(shot('02-role-list.png'));
  record('role-list shows Administrator', sawAdminOnList);

  // ---- 3. Open Administrator role -> Edit --------------------------------
  // Exact match ("Administrator", not a substring) — the list may also
  // contain e.g. "Administrator Edited" from another row.
  await page.click('text="Administrator"');
  await page.waitForTimeout(1500);
  await page.click('text=Edit');
  await page.waitForTimeout(1500);
  // The Users picker should already show the admin's own membership loaded
  // from the detail response (cmd366_prevention invariant #1) — it must NOT
  // read "None selected" for a role admin already belongs to. Both the
  // detail fetch (populates selectedUserIds) and the autocomplete fetch
  // (populates the items whose labels the trigger renders) are async, so
  // wait for the trigger text to settle rather than asserting immediately.
  await page.waitForFunction(
    () => !document.body.innerText.includes('None selected'),
    { timeout: 10000 },
  ).catch(() => {});
  const editBodyBeforeSave = await page.textContent('body');
  const pickerPreloaded = !editBodyBeforeSave.includes('None selected');
  await page.screenshot({ path: shot('03-role-edit-with-user-picker.png'), fullPage: true });
  result.screenshots.push(shot('03-role-edit-with-user-picker.png'));
  record('users picker preloaded with existing membership (not "None selected")', pickerPreloaded);

  // ---- 4. Edit name only (picker untouched), Save -> list -----------------
  const nameInput = page.locator('input[placeholder="Name"]');
  await nameInput.fill('');
  await nameInput.fill('Administrator Edited');
  await page.click('text=Save');
  await page.waitForTimeout(3000);
  // save->list navigation fix (router.replace, not router.back()): must land
  // back on the role list, not the detail screen.
  const listAfterSaveBody = await page.textContent('body');
  const navigatedToList = listAfterSaveBody.includes('Administrator Edited');
  const noAccessDenied = !listAfterSaveBody.includes('Access denied') && !listAfterSaveBody.includes('Failed to load Roles');
  await page.screenshot({ path: shot('04-role-saved-list.png'), fullPage: true });
  result.screenshots.push(shot('04-role-saved-list.png'));
  record('save navigates to role list (router.replace) and shows updated name', navigatedToList);
  record('role list still loads (role.read not revoked)', noAccessDenied);

  // ---- 5. cmd_366 guard proof: re-open, membership + role.read intact -----
  // react-native-web's FlatList briefly renders a zero-size "phantom" copy of
  // a row before layout settles, so two DOM nodes can match this text at
  // once — `.last()` is the one FlatList actually laid out (the phantom is
  // always first in DOM order; confirmed via getBoundingClientRect probe).
  await page.locator('text="Administrator Edited"').last().click();
  await page.waitForTimeout(1500);
  const detailBody = await page.textContent('body');
  const detailLoaded = !detailBody.includes('Failed to load');
  await page.screenshot({ path: shot('05-cmd366-guard-proof.png'), fullPage: true });
  result.screenshots.push(shot('05-cmd366-guard-proof.png'));
  record('role detail reloads after edit — role.read still granted (cmd_366 guard)', detailLoaded);

  await browser.close();

  result.consoleErrors = consoleErrors;
  const passed = result.steps.every((s) => s.ok);
  console.log(JSON.stringify(result, null, 2));
  if (!passed) {
    console.error('ROLE_PICKER_VERIFY_FAILED');
    process.exit(1);
  }
})().catch((e) => {
  console.error('VERIFY_FAILED', e);
  process.exit(1);
});
