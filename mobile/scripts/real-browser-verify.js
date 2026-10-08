// Real-browser verification script for the mobile web bundle. Drives the app
// in Chromium with the DEFAULT security posture (never add
// --disable-web-security: bypassing browser security hides exactly the
// CORS-class gaps this script exists to catch).
//
// A new verification need that does not fit an existing FLOW_TYPE gets a new
// preset added here rather than a new one-off script.
//
// FLOW_TYPE=assert (default)
//   login -> optional tab click -> assert text present / absent.
//   NAV_TEXT         Text of a tab to click after login (optional).
//   ASSERT_TEXT      REQUIRED. Text that must appear.
//   FORBID_TEXT      Text that must NOT appear.
//   SCREENSHOT_PATH  Default: mobile/scripts/real-browser-verify.png
//
// FLOW_TYPE=drill
//   login -> click a footer tab -> assert the group's entity rows are listed.
//   TAB_ID           REQUIRED. testID suffix of the footer tab (e.g. administration).
//   ROW_IDS          REQUIRED. Comma-separated entity names that must be listed.
//   SCREENSHOT_PATH  Default: mobile/scripts/real-browser-verify.png
//
// Common env vars: BASE_URL (falls back to EXPO_WEB_URL, then
// http://localhost:8081), TEST_EMAIL, TEST_PASSWORD.
//
// Example:
//   BASE_URL=http://localhost:8096 FLOW_TYPE=drill TAB_ID=administration \
//     ROW_IDS=user,role node mobile/scripts/real-browser-verify.js
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL ?? process.env.EXPO_WEB_URL ?? 'http://localhost:8081';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';
const FLOW_TYPE = process.env.FLOW_TYPE ?? 'assert';
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH ?? path.join(__dirname, 'real-browser-verify.png');

async function login(page) {
  await page.goto(BASE_URL);
  await page.getByTestId('login-email').fill(TEST_EMAIL);
  await page.getByTestId('login-password').fill(TEST_PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('footer-bar').waitFor({ timeout: 20000 });
}

async function runAssertFlow(page) {
  const NAV_TEXT = process.env.NAV_TEXT ?? '';
  const ASSERT_TEXT = process.env.ASSERT_TEXT;
  const FORBID_TEXT = process.env.FORBID_TEXT ?? '';
  if (!ASSERT_TEXT) {
    console.error('ASSERT_TEXT env var is required for FLOW_TYPE=assert.');
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

async function runDrillFlow(page) {
  const TAB_ID = process.env.TAB_ID;
  const ROW_IDS = (process.env.ROW_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!TAB_ID || ROW_IDS.length === 0) {
    console.error('TAB_ID and ROW_IDS env vars are required for FLOW_TYPE=drill.');
    process.exit(1);
  }
  await login(page);
  await page.getByTestId(`footer-tab-${TAB_ID}`).click();
  const missing = [];
  for (const id of ROW_IDS) {
    const visible = await page.getByTestId(`nav-row-${id}`).isVisible().catch(() => false);
    if (!visible) missing.push(id);
  }
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  return { missing, screenshot: SCREENSHOT_PATH, passed: missing.length === 0 };
}

(async () => {
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
    case 'drill':
      result = await runDrillFlow(page);
      break;
    default:
      console.error(`Unknown FLOW_TYPE "${FLOW_TYPE}". Expected: assert | drill.`);
      process.exit(1);
  }

  await browser.close();
  console.log(JSON.stringify({ ...result, consoleErrors }, null, 2));
  if (!result.passed) {
    console.error('REAL_BROWSER_VERIFY_FAILED');
    process.exit(1);
  }
})().catch((e) => {
  console.error('VERIFY_FAILED', e);
  process.exit(1);
});
