import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema gives
// mobile_note two URL columns: photo_url (image kind) and datasheet_url (`x-uri-kind: file`). The
// form draws each as a plain text input that takes a pasted URL; there is no upload path.

test.describe('URL columns with an upload kind', () => {
  test('are plain inputs, and the pasted URL is sent as the value', async ({ page }) => {
    await login(page);
    await page.getByTestId('footer-tab-mobile_note').click();
    await page.getByTestId('list-new').click();
    await expect(page.getByTestId('form-new-mobile_note')).toBeVisible();
    await expect(page.getByTestId('attachment-pick-photo_url')).toHaveCount(0);
    await expect(page.getByTestId('attachment-pick-datasheet_url')).toHaveCount(0);

    const bodies: Record<string, unknown>[] = [];
    await page.route('**/api/mobile_note', (route) => {
      if (route.request().method() === 'POST') bodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.continue();
    });
    await page.getByTestId('field-title').fill('With URLs');
    await page.getByTestId('field-status-open').click();
    await page.getByTestId('field-photo_url').fill('https://example.com/photo.png');
    await page.getByTestId('field-datasheet_url').fill('https://example.com/sheet.pdf');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_note')).toBeVisible();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].photo_url).toBe('https://example.com/photo.png');
    expect(bodies[0].datasheet_url).toBe('https://example.com/sheet.pdf');
    await expect(page.getByTestId('view-field-photo_url')).toHaveText('https://example.com/photo.png');
  });
});
