import { expect, test } from '@playwright/test';
import { login } from './helpers';

test.describe('Sub-level navigation on the main screen', () => {
  test('selecting a group tab lists its entities on the main screen, with no sidebar', async ({ page }) => {
    await login(page);
    await page.getByTestId('footer-tab-administration').click();
    await expect(page.getByTestId('section-administration')).toBeVisible();
    await expect(page.getByTestId('section-title')).toHaveText('Administration');
    for (const entity of ['user', 'role', 'permission', 'organization']) {
      await expect(page.getByTestId(`nav-row-${entity}`)).toBeVisible();
    }
  });

  test('selecting an entity row opens that entity\'s screen', async ({ page }) => {
    await login(page);
    await page.getByTestId('footer-tab-administration').click();
    await page.getByTestId('nav-row-role').click();
    await expect(page.getByTestId('entity-role')).toBeVisible();
    await page.getByTestId('entity-back').click();
    await expect(page.getByTestId('section-administration')).toBeVisible();
  });

  test('an entity the user may not read is not listed', async ({ page }) => {
    // The server's answer drives the filtering (see cypress/e2e/api/mobile_nav.cy.ts);
    // here the app is shown to prune exactly what the server reports.
    await page.route('**/api/mobile/nav', (route) =>
      route.fulfill({ json: { hiddenHrefs: ['/role', '/permission'] } }),
    );
    await login(page);
    await page.getByTestId('footer-tab-administration').click();
    await expect(page.getByTestId('nav-row-user')).toBeVisible();
    await expect(page.getByTestId('nav-row-role')).toHaveCount(0);
    await expect(page.getByTestId('nav-row-permission')).toHaveCount(0);
  });

  test('a group whose entities are all hidden has no footer tab', async ({ page }) => {
    const all = ['/user', '/role', '/permission', '/organization', '/approval_flow', '/dashboard', '/app_setting', '/audit_log'];
    await page.route('**/api/mobile/nav', (route) => route.fulfill({ json: { hiddenHrefs: all } }));
    await login(page);
    await expect(page.getByTestId('footer-tab-administration')).toHaveCount(0);
    await expect(page.getByTestId('footer-tab-search')).toBeVisible();
  });
});
