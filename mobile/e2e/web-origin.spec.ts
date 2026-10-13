import { expect, test } from '@playwright/test';
import { BASE_URL, TEST_EMAIL, TEST_PASSWORD, login } from './helpers';

// The Expo dev server's own address (scripts/run_mobile_entity_playwright.sh exports it). The app is built to call the
// same-origin proxy (BASE_URL), so a page opened from here is cross-origin to the API and the browser blocks its requests.
const DIRECT_URL = process.env.EXPO_WEB_DIRECT_URL;

test.describe('Server unreachable from the browser', () => {
  test('a network failure on sign-in shows a message instead of an error screen', async ({ page }) => {
    await page.route('**/api/mobile/auth/token', (route) => route.abort('failed'));
    await page.goto(BASE_URL);
    await page.getByTestId('login-email').fill(TEST_EMAIL);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Could not reach the server. Check your connection and try again.');
    // Still on the login screen, and the same-origin page needs no hint about the address.
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('web-origin-hint')).toHaveCount(0);
    // The form is usable again once the server answers.
    await page.unroute('**/api/mobile/auth/token');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('footer-bar')).toBeVisible({ timeout: 20000 });
  });

  test('a failed menu lookup stays fail-closed and says the lookup failed', async ({ page }) => {
    await page.route('**/api/mobile/nav', (route) => route.abort('failed'));
    await page.goto(BASE_URL);
    await page.getByTestId('login-email').fill(TEST_EMAIL);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('footer-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('nav-load-failed')).toContainText('Could not load the menu');
    // Fail closed: only the fixed search tab remains, no schema-driven tab appears.
    await expect(page.getByTestId('footer-bar').locator('[data-testid^="footer-tab-"]')).toHaveCount(1);
    await expect(page.getByTestId('footer-tab-search')).toBeVisible();
  });

  test('a menu that loaded shows no failure notice', async ({ page }) => {
    await login(page);
    await expect(page.getByTestId('footer-tab-administration')).toBeVisible();
    await expect(page.getByTestId('nav-load-failed')).toHaveCount(0);
  });

  test('a page opened from the dev server port says which address to open, and still fails closed', async ({ page }) => {
    if (!DIRECT_URL) throw new Error('EXPO_WEB_DIRECT_URL is not set: the dev server address is needed for this spec');
    await page.goto(DIRECT_URL);
    await expect(page.getByTestId('web-origin-hint')).toContainText(`Open ${new URL(BASE_URL).origin} instead`);
    await page.getByTestId('login-email').fill(TEST_EMAIL);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    // The browser blocks the cross-origin POST: the failure is explained and nobody is signed in.
    await expect(page.getByTestId('login-error')).toHaveText('Could not reach the server. Check your connection and try again.');
    await expect(page.getByTestId('footer-bar')).toHaveCount(0);
  });

  test('the proxy address shows no address hint', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page.getByTestId('login-email')).toBeVisible();
    await expect(page.getByTestId('web-origin-hint')).toHaveCount(0);
  });
});
