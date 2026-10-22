import { expect, test } from '@playwright/test';
import { login } from './helpers';

// The search route is answered here, so the spec checks what the screen does with a result:
// `audit_log` has a native detail screen; `no_such_entity` has no native screens.
const RESULTS = {
  total: 2,
  results: [
    { entity_type: 'audit_log', id: 'audit-1', snippet: 'created <<<widget>>> record', rank: 1 },
    { entity_type: 'no_such_entity', id: 'x-1', snippet: 'a <<<widget>>> elsewhere', rank: 0.5 },
  ],
};

test.describe('Search screen', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.route('**/api/search?*', (route) => route.fulfill({ json: RESULTS }));
    await page.getByTestId('footer-tab-search').click();
    await page.getByTestId('search-input').fill('widget');
    await page.getByTestId('search-input').press('Enter');
  });

  test('a result opens the record detail screen', async ({ page }) => {
    await page.getByTestId('search-result-audit_log').click();
    await expect(page).toHaveURL(/\/entity\/audit_log\/audit-1$/);
  });

  test('a result for an entity without native screens is marked and does not navigate', async ({ page }) => {
    const row = page.getByTestId('search-result-no_such_entity');
    await expect(row).toBeVisible();
    await expect(page.getByTestId('search-result-unavailable-no_such_entity')).toHaveText('Not available in the app');
    await row.click({ force: true });
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('the match markers are not shown raw', async ({ page }) => {
    await expect(page.getByTestId('search-result-audit_log')).toContainText('created widget record');
    await expect(page.getByTestId('search-result-audit_log')).not.toContainText('<<<');
  });
});
