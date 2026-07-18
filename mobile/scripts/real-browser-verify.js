// Reusable real-browser (default Chromium security, no
// --disable-web-security) verification script for the mobile PoC
// completion gate. See docs/knowledge/mobile-poc-test-runbook.md.
//
// Proves that a login + one navigation/assertion step works the way a
// human opening the app in an actual browser would experience it — not
// just the way the automated Playwright suite (which disables web
// security for some specs) sees it. Originally written ad hoc for
// subtask_368a (cmd_368); generalized here so future mobile PoC tasks
// reuse and extend it instead of re-writing it each time.
//
// Env vars (all optional except ASSERT_TEXT):
//   BASE_URL        URL to open. Default: http://localhost:8081
//   TEST_EMAIL      Default: test@example.com
//   TEST_PASSWORD   Default: password123
//   NAV_TEXT        Text of a tab/link to click after login (e.g. "Roles").
//                    Omit to only verify login.
//   ASSERT_TEXT     REQUIRED. Text that must appear on the page after
//                    login/navigation (e.g. "Administrator").
//   FORBID_TEXT     Text that must NOT appear (e.g. "Failed to load Roles").
//   SCREENSHOT_PATH Default: mobile/scripts/real-browser-verify.png
//
// Example:
//   BASE_URL=http://localhost:8096 NAV_TEXT=Roles ASSERT_TEXT=Administrator \
//     FORBID_TEXT="Failed to load Roles" node mobile/scripts/real-browser-verify.js
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:8081';
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';
const NAV_TEXT = process.env.NAV_TEXT ?? '';
const ASSERT_TEXT = process.env.ASSERT_TEXT;
const FORBID_TEXT = process.env.FORBID_TEXT ?? '';
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH ?? path.join(__dirname, 'real-browser-verify.png');

if (!ASSERT_TEXT) {
  console.error('ASSERT_TEXT env var is required (text expected on screen after login/navigation).');
  process.exit(1);
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

  await page.goto(BASE_URL);
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
  await page.click('text=Sign In');
  await page.waitForSelector('text=Welcome back.', { timeout: 15000 });

  if (NAV_TEXT) {
    await page.click(`text=${NAV_TEXT}`);
    await page.waitForTimeout(2000);
  }

  const bodyText = await page.textContent('body');
  const sawAssertText = bodyText.includes(ASSERT_TEXT);
  const sawForbidText = FORBID_TEXT ? bodyText.includes(FORBID_TEXT) : false;

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
  await browser.close();

  const result = { sawAssertText, sawForbidText, consoleErrors, screenshot: SCREENSHOT_PATH };
  console.log(JSON.stringify(result, null, 2));

  const passed = sawAssertText && !sawForbidText;
  if (!passed) {
    console.error('REAL_BROWSER_VERIFY_FAILED');
    process.exit(1);
  }
})().catch((e) => {
  console.error('VERIFY_FAILED', e);
  process.exit(1);
});
