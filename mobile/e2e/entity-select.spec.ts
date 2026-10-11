import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds mobile_rule:
// `entity_name` is an x-entity-select field (the name of one of the schema's entities). The form draws it as
// chips labelled with the entity titles and saves the entity name.

async function openNew(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_rule').click();
  await expect(page.getByTestId('list-mobile_rule')).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_rule')).toBeVisible();
}

/** Records the JSON body of the next write to the entity's REST route. */
function captureWrite(page: Page, method: 'POST' | 'PUT') {
  const bodies: Record<string, unknown>[] = [];
  void page.route('**/api/mobile_rule**', (route) => {
    const request = route.request();
    if (request.method() === method && /\/api\/mobile_rule(\/[^/?]+)?$/.test(new URL(request.url()).pathname)) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
    return route.continue();
  });
  return bodies;
}

test.describe('Entity select field', () => {
  test('the chips show entity titles and the record saves the entity name', async ({ page }) => {
    const bodies = captureWrite(page, 'POST');
    await openNew(page);
    await page.getByTestId('field-name').fill('Notes rule');
    await expect(page.getByTestId('field-entity_name-mobile_note')).toContainText('Mobile Note');
    await page.getByTestId('field-entity_name-mobile_note').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_rule')).toBeVisible();
    await expect(page.getByTestId('view-field-entity_name')).toHaveText('Mobile Note');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.entity_name).toBe('mobile_note');
  });

  test('editing switches the entity and the detail shows the new title', async ({ page }) => {
    const bodies = captureWrite(page, 'PUT');
    await openNew(page);
    await page.getByTestId('field-name').fill('Switch rule');
    await page.getByTestId('field-entity_name-mobile_note').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-entity_name')).toHaveText('Mobile Note');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_rule')).toBeVisible();
    await page.getByTestId('field-entity_name-mobile_log').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-entity_name')).toHaveText('Mobile Log');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.entity_name).toBe('mobile_log');
  });

  test('the shared validation requires an entity before any request', async ({ page }) => {
    let writes = 0;
    await page.route('**/api/mobile_rule', (route) => {
      if (route.request().method() === 'POST') writes += 1;
      return route.continue();
    });
    await openNew(page);
    await page.getByTestId('field-name').fill('No entity');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toBeVisible();
    expect(writes).toBe(0);
  });

  test('the list shows the entity title', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('field-name').fill('Listed rule');
    await page.getByTestId('field-entity_name-mobile_note').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_rule')).toBeVisible();
    await page.getByTestId('view-back').click();
    await expect(page.getByText('Listed rule')).toBeVisible();
    await expect(page.getByText('Mobile Note').first()).toBeVisible();
  });
});
