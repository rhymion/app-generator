import { test, expect } from '@playwright/test';

const BASE_URL = process.env.EXPO_WEB_URL ?? 'http://localhost:8081';
// Matches scripts/seed-tenant.ts's seeded admin user.
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';

test.describe('Mobile token auth (cmd_357)', () => {
  // Scoped to the token lifecycle only. The Roles tab (list → detail →
  // edit → save) has its own runtime smoke coverage in role-crud.spec.ts
  // (cmd_359), which fixed the QueryClientProvider and nested-route bugs
  // that used to block it.
  test('email/password login reaches the authenticated app shell, and survives a reload via the stored refresh token', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
    await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
    await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
    await page.click('text=Sign In');

    // Login succeeded: POST /api/mobile/auth/token → setTokens() → auth
    // guard passes → authenticated app shell renders.
    await expect(page.locator('text=Welcome back.')).toBeVisible({ timeout: 15000 });

    // Reload clears the in-memory access token by design (354a section_4).
    // Staying authenticated after reload proves the persisted refresh
    // token + the auth guard's getRefreshToken() presence check + apiFetch's
    // 401-triggered silent refresh all work together, not just the login
    // call in isolation.
    await page.reload();
    await expect(page.locator('text=Welcome back.')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('input[placeholder="you@example.com"]')).toHaveCount(0);
  });
});
