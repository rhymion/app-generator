import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_stay (an x-reservation entity) and mobile_room (its pool, seeded with one free "single" room).

async function openStayForm(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_stay').click();
  await expect(page.getByTestId('list-mobile_stay')).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_stay')).toBeVisible();
}

test.describe('Reservation entity on the native screens', () => {
  test('the allocated room is optional on the form, and the server allocates one on save', async ({ page }) => {
    await openStayForm(page);
    await page.getByTestId('field-guest_name').fill('Alice');
    await page.getByTestId('field-category').fill('single');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_stay')).toBeVisible();
  });

  test('a request that no room can satisfy shows the capacity text, not the stale-update warning', async ({ page }) => {
    await openStayForm(page);
    await page.getByTestId('field-guest_name').fill('Bob');
    await page.getByTestId('field-category').fill('suite');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-error')).toHaveText('No capacity is available. Please try a different selection.');
  });
});
