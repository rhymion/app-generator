// Reusable real-browser (default Chromium security, no
// --disable-web-security) verification script for mobile PoC completion
// gates. See docs/knowledge/mobile-poc-test-runbook.md.
//
// Proves that a flow works the way a human opening the app in an actual
// browser would experience it — not just the way the automated Playwright
// suite sees it. Originally written ad hoc for subtask_368a (cmd_368);
// generalized for reuse (cmd_384/subtask_387b) via the FLOW_TYPE env var
// so feature-specific verifications extend this file instead of forking
// new one-off scripts (see mobile-poc-test-runbook.md "Reusable scripts").
//
// FLOW_TYPE selects the preset (default: "assert" — the original
// login+nav+assert shape, kept byte-for-byte behavior-compatible with
// pre-FLOW_TYPE callers such as subtask_368a's documented invocation):
//
//   FLOW_TYPE=assert       (default) login -> optional NAV_TEXT click ->
//                          assert ASSERT_TEXT present / FORBID_TEXT absent.
//   FLOW_TYPE=create-picker  login -> nav to a list -> open create form ->
//                          fill a field -> pick an FK/option from a picker
//                          -> save -> assert the new row appears.
//                          (Replaces permission-picker-verify.js.)
//   FLOW_TYPE=edit-picker    login -> nav to a list -> open a row -> Edit ->
//                          assert an m2m/FK picker is preloaded -> edit a
//                          field -> save -> assert persisted -> reopen ->
//                          assert it still loads (permission-guard proof).
//                          (Replaces role-picker-verify.js.)
//
// Common env vars (all flows):
//   BASE_URL        URL to open. Falls back to EXPO_WEB_URL (the var name
//                    the Playwright specs use), then http://localhost:8081.
//   TEST_EMAIL      Default: test@example.com
//   TEST_PASSWORD   Default: password123
//   FLOW_TYPE       assert (default) | create-picker | edit-picker
//
// FLOW_TYPE=assert env vars:
//   NAV_TEXT         Text of a tab/link to click after login. Omit to only
//                     verify login.
//   ASSERT_TEXT      REQUIRED. Text that must appear after login/nav.
//   FORBID_TEXT      Text that must NOT appear.
//   SCREENSHOT_PATH  Default: mobile/scripts/real-browser-verify.png
//
// FLOW_TYPE=create-picker env vars:
//   NAV_TEXT           REQUIRED. List tab to click (e.g. "Permissions").
//   CREATE_TRIGGER     Text of the create button. Default: "+"
//   FIELD_NAME          Placeholder of the text field to fill. Default: "Name"
//   FIELD_VALUE          Value to fill. Default: "<NAV_TEXT>Test-<timestamp>"
//   PICKER_TRIGGER_TEXT  Unselected-state text of the picker. Default: "None selected"
//   PICKER_OPTION_TEXT   REQUIRED. Option text to select (exact match).
//   SCREENSHOT_DIR       Default: mobile/scripts/real-browser-verify-screenshots
//
// FLOW_TYPE=edit-picker env vars:
//   NAV_TEXT             REQUIRED. List tab to click (e.g. "Roles").
//   TARGET_TEXT          REQUIRED. Row text to open (exact match).
//   FIELD_NAME            Placeholder of the text field to edit. Default: "Name"
//   FIELD_VALUE            Value to set. Default: "<TARGET_TEXT> Edited-<timestamp>"
//   PICKER_TRIGGER_TEXT    Unselected-state text asserted absent once the
//                           picker preloads existing membership. Default: "None selected"
//   SCREENSHOT_DIR         Default: mobile/scripts/real-browser-verify-screenshots
//
// Examples:
//   BASE_URL=http://localhost:8096 NAV_TEXT=Roles ASSERT_TEXT=Administrator \
//     FORBID_TEXT="Failed to load Roles" node mobile/scripts/real-browser-verify.js
//
//   FLOW_TYPE=create-picker BASE_URL=http://localhost:8090 NAV_TEXT=Permissions \
//     PICKER_OPTION_TEXT=Administrator node mobile/scripts/real-browser-verify.js
//
//   FLOW_TYPE=edit-picker BASE_URL=http://localhost:8090 NAV_TEXT=Roles \
//     TARGET_TEXT=Administrator node mobile/scripts/real-browser-verify.js
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL ?? process.env.EXPO_WEB_URL ?? 'http://localhost:8081';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';
const FLOW_TYPE = process.env.FLOW_TYPE ?? 'assert';

async function login(page) {
  await page.goto(BASE_URL);
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
  await page.click('text=Sign In');
  await page.waitForSelector('text=Welcome back.', { timeout: 15000 });
}

// ---- FLOW_TYPE=assert (default; original single login+nav+assert shape) --
async function runAssertFlow(page) {
  const NAV_TEXT = process.env.NAV_TEXT ?? '';
  const ASSERT_TEXT = process.env.ASSERT_TEXT;
  const FORBID_TEXT = process.env.FORBID_TEXT ?? '';
  const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH ?? path.join(__dirname, 'real-browser-verify.png');

  if (!ASSERT_TEXT) {
    console.error('ASSERT_TEXT env var is required for FLOW_TYPE=assert (text expected on screen after login/navigation).');
    process.exit(1);
  }

  await login(page);

  if (NAV_TEXT) {
    await page.click(`text=${NAV_TEXT}`);
    await page.waitForTimeout(2000);
  }

  const bodyText = await page.textContent('body');
  const sawAssertText = bodyText.includes(ASSERT_TEXT);
  const sawForbidText = FORBID_TEXT ? bodyText.includes(FORBID_TEXT) : false;

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  return { sawAssertText, sawForbidText, screenshot: SCREENSHOT_PATH, passed: sawAssertText && !sawForbidText };
}

// ---- FLOW_TYPE=create-picker (replaces permission-picker-verify.js) ------
async function runCreatePickerFlow(page) {
  const NAV_TEXT = process.env.NAV_TEXT;
  const CREATE_TRIGGER = process.env.CREATE_TRIGGER ?? '+';
  const FIELD_NAME = process.env.FIELD_NAME ?? 'Name';
  const FIELD_VALUE = process.env.FIELD_VALUE ?? `${NAV_TEXT ?? 'Entity'}Test-${Date.now()}`;
  const PICKER_TRIGGER_TEXT = process.env.PICKER_TRIGGER_TEXT ?? 'None selected';
  const PICKER_OPTION_TEXT = process.env.PICKER_OPTION_TEXT;
  const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(__dirname, 'real-browser-verify-screenshots');

  if (!NAV_TEXT) {
    console.error('NAV_TEXT env var is required for FLOW_TYPE=create-picker.');
    process.exit(1);
  }
  if (!PICKER_OPTION_TEXT) {
    console.error('PICKER_OPTION_TEXT env var is required for FLOW_TYPE=create-picker.');
    process.exit(1);
  }

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shot = (n) => path.join(SCREENSHOT_DIR, n);
  const steps = [];
  const record = (step, ok, detail) => {
    steps.push({ step, ok, detail });
    console.log(`[${ok ? 'OK' : 'FAIL'}] ${step}${detail ? ' — ' + detail : ''}`);
  };

  await login(page);
  record('login', true);

  await page.click(`text=${NAV_TEXT}`);
  await page.waitForTimeout(2000);
  const listBody = await page.textContent('body');
  const listLoaded = !listBody.includes('Failed to load');
  await page.screenshot({ path: shot('01-list.png'), fullPage: true });
  record(`${NAV_TEXT} list loads`, listLoaded);

  await page.click(`text=${CREATE_TRIGGER}`);
  await page.waitForTimeout(1500);
  await page.fill(`input[placeholder="${FIELD_NAME}"]`, FIELD_VALUE);
  await page.click(`text=${PICKER_TRIGGER_TEXT}`);
  await page.waitForTimeout(1000);
  await page.click(`text="${PICKER_OPTION_TEXT}"`);
  await page.waitForTimeout(500);
  const editBody = await page.textContent('body');
  const pickerSelected = editBody.includes(PICKER_OPTION_TEXT) && !editBody.includes(PICKER_TRIGGER_TEXT);
  await page.screenshot({ path: shot('02-create-with-picker.png'), fullPage: true });
  record(`picker shows ${PICKER_OPTION_TEXT} selected (not "${PICKER_TRIGGER_TEXT}")`, pickerSelected);

  await page.click('text=Save');
  await page.waitForTimeout(3000);
  const savedBody = await page.textContent('body');
  const navigatedToList = savedBody.includes(FIELD_VALUE);
  const noSaveError = !savedBody.includes('Something went wrong') && !savedBody.includes('Failed to load');
  await page.screenshot({ path: shot('03-saved.png'), fullPage: true });
  record('save navigates to list and shows new row', navigatedToList);
  record('no save/load error after create', noSaveError);

  return { steps, screenshotDir: SCREENSHOT_DIR, passed: steps.every((s) => s.ok) };
}

// ---- FLOW_TYPE=edit-picker (replaces role-picker-verify.js) --------------
async function runEditPickerFlow(page) {
  const NAV_TEXT = process.env.NAV_TEXT;
  const TARGET_TEXT = process.env.TARGET_TEXT;
  const FIELD_NAME = process.env.FIELD_NAME ?? 'Name';
  const FIELD_VALUE = process.env.FIELD_VALUE ?? `${TARGET_TEXT ?? 'Row'} Edited-${Date.now()}`;
  const PICKER_TRIGGER_TEXT = process.env.PICKER_TRIGGER_TEXT ?? 'None selected';
  const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? path.join(__dirname, 'real-browser-verify-screenshots');

  if (!NAV_TEXT) {
    console.error('NAV_TEXT env var is required for FLOW_TYPE=edit-picker.');
    process.exit(1);
  }
  if (!TARGET_TEXT) {
    console.error('TARGET_TEXT env var is required for FLOW_TYPE=edit-picker.');
    process.exit(1);
  }

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const shot = (n) => path.join(SCREENSHOT_DIR, n);
  const steps = [];
  const record = (step, ok, detail) => {
    steps.push({ step, ok, detail });
    console.log(`[${ok ? 'OK' : 'FAIL'}] ${step}${detail ? ' — ' + detail : ''}`);
  };

  await login(page);
  record('login', true);

  await page.click(`text=${NAV_TEXT}`);
  await page.waitForTimeout(2000);
  const listBody = await page.textContent('body');
  const sawTarget = listBody.includes(TARGET_TEXT);
  await page.screenshot({ path: shot('01-list.png'), fullPage: true });
  record(`${NAV_TEXT} list shows ${TARGET_TEXT}`, sawTarget);

  await page.click(`text="${TARGET_TEXT}"`);
  await page.waitForTimeout(1500);
  await page.click('text=Edit');
  await page.waitForTimeout(1500);
  // Async detail + autocomplete fetches populate the picker's preloaded
  // selection — wait for it to settle rather than asserting immediately
  // (see role-picker-verify.js's original comment for why).
  await page.waitForFunction(
    (triggerText) => !document.body.innerText.includes(triggerText),
    PICKER_TRIGGER_TEXT,
    { timeout: 10000 },
  ).catch(() => {});
  const editBody = await page.textContent('body');
  const pickerPreloaded = !editBody.includes(PICKER_TRIGGER_TEXT);
  await page.screenshot({ path: shot('02-edit-with-picker.png'), fullPage: true });
  record(`picker preloaded with existing selection (not "${PICKER_TRIGGER_TEXT}")`, pickerPreloaded);

  const fieldInput = page.locator(`input[placeholder="${FIELD_NAME}"]`);
  await fieldInput.fill('');
  await fieldInput.fill(FIELD_VALUE);
  await page.click('text=Save');
  await page.waitForTimeout(3000);
  const savedListBody = await page.textContent('body');
  const navigatedToList = savedListBody.includes(FIELD_VALUE);
  const noAccessDenied = !savedListBody.includes('Access denied') && !savedListBody.includes('Failed to load');
  await page.screenshot({ path: shot('03-saved-list.png'), fullPage: true });
  record('save navigates to list and shows updated value', navigatedToList);
  record('list still loads (read permission not revoked)', noAccessDenied);

  // Reopen — proves the row (and the read permission that renders it)
  // survived the edit, not just that the save call returned 200.
  await page.locator(`text="${FIELD_VALUE}"`).last().click();
  await page.waitForTimeout(1500);
  const detailBody = await page.textContent('body');
  const detailLoaded = !detailBody.includes('Failed to load');
  await page.screenshot({ path: shot('04-reopen-detail.png'), fullPage: true });
  record('detail reloads after edit', detailLoaded);

  return { steps, screenshotDir: SCREENSHOT_DIR, passed: steps.every((s) => s.ok) };
}

(async () => {
  // No launchOptions: default Chromium security posture. Do NOT add
  // --disable-web-security here — bypassing browser security is exactly
  // the gap this script exists to catch (see cmd_368/cmd_359).
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  let result;
  switch (FLOW_TYPE) {
    case 'assert':
      result = await runAssertFlow(page);
      break;
    case 'create-picker':
      result = await runCreatePickerFlow(page);
      break;
    case 'edit-picker':
      result = await runEditPickerFlow(page);
      break;
    default:
      console.error(`Unknown FLOW_TYPE "${FLOW_TYPE}". Expected: assert | create-picker | edit-picker.`);
      process.exit(1);
  }

  await browser.close();

  const output = { ...result, consoleErrors };
  console.log(JSON.stringify(output, null, 2));

  if (!result.passed) {
    console.error('REAL_BROWSER_VERIFY_FAILED');
    process.exit(1);
  }
})().catch((e) => {
  console.error('VERIFY_FAILED', e);
  process.exit(1);
});
