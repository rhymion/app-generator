import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_invoice: a one-to-many child collection (`lines`). Each line has a required description,
// a required quantity, a status with a default, an optional date and a required foreign key to
// mobile_group. The script seeds two groups, "Alpha Group" and "Beta Group".

async function openNew(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_invoice').click();
  await expect(page.getByTestId('list-mobile_invoice')).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_invoice')).toBeVisible();
}

/** Opens a row's group picker and taps one candidate. */
async function pickGroup(page: Page, row: number, optionId: string) {
  const field = `lines-${row}-mobile_group_id`;
  await page.getByTestId(`picker-open-${field}`).click();
  await expect(page.getByTestId(`picker-modal-${field}`)).toBeVisible();
  await page.getByTestId(`picker-option-${optionId}`).click();
  // The modal slides out; typing before it is gone would land in its search box.
  await expect(page.getByTestId(`picker-modal-${field}`)).toBeHidden();
}

/** Fills the text, number and group of one row. */
async function fillRow(page: Page, row: number, description: string, quantity: string, groupOptionId: string) {
  await page.getByTestId(`field-lines-${row}-description`).fill(description);
  await page.getByTestId(`field-lines-${row}-quantity`).fill(quantity);
  await pickGroup(page, row, groupOptionId);
}

/** Records the JSON body of every write to the entity's REST routes. */
function captureWrites(page: Page, method: 'POST' | 'PUT') {
  const bodies: Record<string, unknown>[] = [];
  void page.route('**/api/mobile_invoice**', (route) => {
    const request = route.request();
    if (request.method() === method && /\/api\/mobile_invoice(\/[^/?]+)?$/.test(new URL(request.url()).pathname)) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
    return route.continue();
  });
  return bodies;
}

type SentLine = { id?: string; description: string; quantity: number; mobile_group_id: string; line_status?: string; shipped_on: string | null };

test.describe('Child rows: an editable one-to-many collection', () => {
  test('rows are added, saved with the record and listed on the detail screen', async ({ page }) => {
    const bodies = captureWrites(page, 'POST');
    await openNew(page);
    await page.getByTestId('field-invoice_no').fill('INV-1');
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 0, 'Widgets', '3', 'group-seed-1');
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 1, 'Gadgets', '5', 'group-seed-2');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_invoice')).toBeVisible();
    const lines = page.getByTestId('view-field-lines');
    await expect(lines).toContainText('Description: Widgets');
    await expect(lines).toContainText('Quantity: 3');
    await expect(lines).toContainText('Mobile Group: Alpha Group');
    await expect(lines).toContainText('Description: Gadgets');
    await expect(lines).toContainText('Mobile Group: Beta Group');
    expect(bodies).toHaveLength(1);
    const sent = bodies[0].lines as SentLine[];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ description: 'Widgets', quantity: 3, mobile_group_id: 'group-seed-1', shipped_on: null });
    // a new row starts at the schema default, so the field travels with it
    expect(sent[0]).toMatchObject({ line_status: 'open' });
    expect(sent[0]).not.toHaveProperty('id');
  });

  test('a row missing a required field blocks the save and names the row and the field', async ({ page }) => {
    const bodies = captureWrites(page, 'POST');
    await openNew(page);
    await page.getByTestId('field-invoice_no').fill('INV-2');
    await page.getByTestId('row-lines-add').click();
    await page.getByTestId('field-lines-0-description').fill('No quantity');
    await pickGroup(page, 0, 'group-seed-1');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toContainText('Lines 1: Quantity is required');
    expect(bodies).toHaveLength(0);
  });

  test('editing keeps a saved row by id, changes it, removes another and adds a new one', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('field-invoice_no').fill('INV-3');
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 0, 'Keep', '1', 'group-seed-1');
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 1, 'Drop', '2', 'group-seed-1');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_invoice')).toBeVisible();

    const bodies = captureWrites(page, 'PUT');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_invoice')).toBeVisible();
    // the saved rows are loaded into the editor
    await expect(page.getByTestId('field-lines-0-description')).toHaveValue('Keep');
    await expect(page.getByTestId('field-lines-1-description')).toHaveValue('Drop');
    await page.getByTestId('field-lines-0-quantity').fill('9');
    await page.getByTestId('field-lines-0-line_status-billed').click();
    await page.getByTestId('row-lines-1-remove').click();
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 1, 'Added', '4', 'group-seed-2');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_invoice')).toBeVisible();

    expect(bodies).toHaveLength(1);
    const sent = bodies[0].lines as SentLine[];
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ description: 'Keep', quantity: 9, line_status: 'billed' });
    expect(typeof sent[0].id).toBe('string');
    expect(sent[1]).toMatchObject({ description: 'Added', quantity: 4 });
    expect(sent[1]).not.toHaveProperty('id');

    const lines = page.getByTestId('view-field-lines');
    await expect(lines).toContainText('Description: Keep');
    await expect(lines).toContainText('Quantity: 9');
    await expect(lines).toContainText('Description: Added');
    await expect(lines).not.toContainText('Drop');
  });

  test('the REST detail returns the saved rows, so a reload shows what the server holds', async ({ page }) => {
    await openNew(page);
    await page.getByTestId('field-invoice_no').fill('INV-4');
    await page.getByTestId('row-lines-add').click();
    await fillRow(page, 0, 'Persisted', '7', 'group-seed-1');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_invoice')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('view-field-lines')).toContainText('Description: Persisted');
  });
});
