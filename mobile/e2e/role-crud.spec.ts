import { test, expect } from '@playwright/test';

const BASE_URL = process.env.EXPO_WEB_URL ?? 'http://localhost:8081';
// Matches scripts/seed-tenant.ts's seeded admin user.
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'admin@example.com';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'password123';

// Runtime smoke gate for cmd_359. This is the machine check that would have
// caught cmd_348's FAIL-3 (role screens crashing with "No QueryClient set,
// use QueryClientProvider to set one" because app/_layout.tsx.jinja2 never
// wrapped the app in a QueryClientProvider) and the Roles-tab-flattening bug
// (role/index, role/[id], role/edit showing up as three separate tabs
// instead of one, because app/(app)/role/ had no _layout.tsx to group them
// under a Stack). Every screen in this walkthrough uses useQuery/useMutation
// (app/(app)/role/index.tsx.jinja2, [id].tsx.jinja2, edit.tsx.jinja2), so any
// future regression that drops the provider or the nested layout fails this
// test immediately instead of silently shipping through tsc/expo export
// (neither of which renders the app).
test.describe('Mobile role screens runtime smoke (cmd_359)', () => {
  test('login -> single Roles tab -> list -> detail -> edit -> save -> persists on refetch', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 30000 });
    await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
    await page.fill('input[placeholder="Password"]', TEST_PASSWORD);
    await page.click('text=Sign In');
    await expect(page.locator('text=Welcome back.')).toBeVisible({ timeout: 15000 });

    // Exactly one "Roles" tab, not the raw route names (role/edit, role/index,
    // role/[id]) that showed up pre-fix.
    await expect(page.getByText('Roles', { exact: true })).toHaveCount(1);
    await expect(page.getByText('role/index')).toHaveCount(0);
    await expect(page.getByText('role/edit')).toHaveCount(0);

    await page.click('text=Roles');

    // Would crash with "No QueryClient set..." pre-fix instead of rendering.
    // (Shared test DB may carry more than one "Administrator" row from
    // concurrent agent sessions — .first() keeps this a rendering check,
    // not a row-count assertion.)
    await expect(page.getByText('Administrator').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No QueryClient set', { exact: false })).toHaveCount(0);

    await page.getByText('Administrator').first().click();
    await expect(page.getByText('Name', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.click('text=Edit');

    const description = `cmd_359 smoke ${Date.now()}`;
    await page.fill('[placeholder="Description"]', description);
    await page.click('text=Save');

    // Save invalidates the role-list query and navigates back to the detail
    // screen. Re-entering via the Roles tab (which resets that tab's stack)
    // and the list row again forces a fresh mount/fetch of the detail screen
    // — proving the edit actually persisted server-side, not just optimistic
    // local state.
    await expect(page.getByText('Name', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await page.click('text=Roles');
    await expect(page.getByText('Administrator').first()).toBeVisible({ timeout: 10000 });
    await page.getByText('Administrator').first().click();
    // react-native-web sometimes flattens adjacent <Text> into an
    // accessibility node whose own bounding box reads as non-visible to
    // Playwright even though the text is genuinely on screen (confirmed via
    // the accessibility-tree snapshot during triage) — check DOM presence
    // rather than CSS visibility to avoid that false negative.
    await expect(page.getByText(description).first()).toBeAttached({ timeout: 10000 });
  });
});
