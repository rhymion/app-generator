import { expect, test } from '@playwright/test';
import { BASE_URL, TEST_EMAIL, TEST_PASSWORD, login } from './helpers';

test.describe('Server unreachable', () => {
  test('a network failure on sign-in shows a message instead of an error screen', async ({ page }) => {
    await page.route('**/api/mobile/auth/token', (route) => route.abort('failed'));
    await page.goto(BASE_URL);
    await page.getByTestId('login-email').fill(TEST_EMAIL);
    await page.getByTestId('login-password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Could not reach the server. Check your connection and try again.');
    // Still on the login screen.
    await expect(page.getByTestId('login-email')).toBeVisible();
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
});
