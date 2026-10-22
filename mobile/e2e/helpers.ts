import { expect, type Page } from '@playwright/test';

export const BASE_URL = process.env.EXPO_WEB_URL ?? 'http://localhost:8081';
// Matches the administrator that `npm run db:seed-baseline` creates
// (DEFAULT_ADMIN_EMAIL in scripts/seed-baseline-credentials.ts).
export const TEST_EMAIL = process.env.TEST_EMAIL ?? 'admin@example.com';
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';

/** Signs in through the login screen and waits for the authenticated shell. */
export async function login(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByTestId('login-email').fill(TEST_EMAIL);
  await page.getByTestId('login-password').fill(TEST_PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('footer-bar')).toBeVisible({ timeout: 20000 });
}
