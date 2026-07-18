// Real-browser (default Chromium security, no --disable-web-security)
// verification of the cmd_376 batch2 mobile permission FK (role) picker
// flow. See docs/knowledge/mobile-poc-test-runbook.md for why a
// real-browser check is mandatory in addition to the automated
// Playwright/Cypress suites.
//
// Purpose-built companion script (same conventions as role-picker-verify.js:
// default security posture, no CORS bypass, env-var configured), covering
// the multi-page create flow: login -> permission list -> new -> fill name +
// toggles + role FK picker (multi=false) -> save -> list shows new row.
//
// Env vars:
//   BASE_URL         URL to open. Default: http://localhost:8090
//   TEST_EMAIL        Default: admin@example.com
//   TEST_PASSWORD     Default: password123
//   SCREENSHOT_DIR    Default: mobile/scripts/permission-picker-verify-screenshots
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8090';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(__dirname, 'permission-picker-verify-screenshots');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
const shot = (n) => path.join(SCREENSHOT_DIR, n);

(async () => {
  // No launchOptions: default Chromium security posture (no
  // --disable-web-security) — see real-browser-verify.js header comment.
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

  const uniqueName = `MobileFKTest-${Date.now()}`;

  // ---- 1. Login ----------------------------------------------------------
  await page.goto(BASE_URL);
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
  await page.click('text=Sign In');
  await page.waitForSelector('text=Welcome back.', { timeout: 15000 });
  record('login', true);

  // ---- 2. Navigate to Permissions list ------------------------------------
  await page.click('text=Permissions');
  await page.waitForTimeout(2000);
  const listBody = await page.textContent('body');
  const listLoaded = !listBody.includes('Failed to load');
  await page.screenshot({ path: shot('06-permission-list.png'), fullPage: true });
  result.screenshots.push(shot('06-permission-list.png'));
  record('permission list loads', listLoaded);

  // ---- 3. New permission: fill name, pick Role ----------------------------
  // create/read/update/delete toggles are left at their default (false) —
  // this test's focus is the FK picker + required-boolean wiring, i.e. that
  // create() succeeds with explicit false values (not undefined) for those
  // required fields, not the toggle UI itself.
  await page.click('text=+');
  await page.waitForTimeout(1500);
  await page.fill('input[placeholder="Name"]', uniqueName);
  // Open the Role FK picker (trigger shows "None selected" until opened —
  // the label Text itself isn't the Pressable) and select Administrator.
  await page.click('text=None selected');
  await page.waitForTimeout(1000);
  await page.click('text="Administrator"');
  await page.waitForTimeout(500);
  const editBody = await page.textContent('body');
  const roleSelected = editBody.includes('Administrator') && !editBody.includes('None selected');
  await page.screenshot({ path: shot('07-permission-edit-with-role-picker.png'), fullPage: true });
  result.screenshots.push(shot('07-permission-edit-with-role-picker.png'));
  record('role FK picker shows Administrator selected (not "None selected")', roleSelected);

  // ---- 4. Save -> list shows the new permission ---------------------------
  await page.click('text=Save');
  await page.waitForTimeout(3000);
  const listAfterSaveBody = await page.textContent('body');
  const navigatedToList = listAfterSaveBody.includes(uniqueName);
  const noSaveError = !listAfterSaveBody.includes('Something went wrong') && !listAfterSaveBody.includes('Failed to load');
  await page.screenshot({ path: shot('08-permission-saved.png'), fullPage: true });
  result.screenshots.push(shot('08-permission-saved.png'));
  record('save navigates to permission list and shows new row (create succeeded with required booleans + FK)', navigatedToList);
  record('no save/load error after create', noSaveError);

  await browser.close();

  result.consoleErrors = consoleErrors;
  const passed = result.steps.every((s) => s.ok);
  console.log(JSON.stringify(result, null, 2));
  if (!passed) {
    console.error('PERMISSION_PICKER_VERIFY_FAILED');
    process.exit(1);
  }
})().catch((e) => {
  console.error('VERIFY_FAILED', e);
  process.exit(1);
});
