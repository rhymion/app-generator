import { expect, test } from '@playwright/test';
import { BASE_URL, TEST_EMAIL, login } from './helpers';

test.describe('Mobile sign-in', () => {
  test('email/password login reaches the app shell and survives a reload via the stored refresh token', async ({ page }) => {
    await login(page);
    await expect(page.getByTestId('home-screen')).toBeVisible();

    // A reload drops the in-memory access token by design. Staying signed in
    // proves the persisted refresh token, the auth guard and apiFetch's
    // 401-triggered silent refresh work together.
    await page.reload();
    await expect(page.getByTestId('footer-bar')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('login-email')).toHaveCount(0);
  });

  test('a wrong password shows an error and stays on the login screen', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByTestId('login-email').fill(TEST_EMAIL);
    await page.getByTestId('login-password').fill('not-the-password');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toHaveText('Invalid email or password.');
    await expect(page.getByTestId('footer-bar')).toHaveCount(0);
  });

  test('sign out returns to the login screen and a reload does not restore the session', async ({ page }) => {
    await login(page);
    await page.getByTestId('header-signout').click();
    await expect(page.getByTestId('login-email')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('login-email')).toBeVisible();
  });
});
