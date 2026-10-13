import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh (fixture mode), whose schema adds
// mobile_gadget: an entity with hand-written native components. The script places hand-written versions of
// GadgetToolbar (list), GadgetSummary (view), GadgetBanner (edit) and the `code` field before generation; the
// generator keeps files that exist. GadgetNote (edit) and the `pin` field keep the generated stub, which draws
// nothing, so the run covers both a filled slot and an empty one.

type Body = Record<string, unknown>;

async function openList(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_gadget').click();
  await expect(page.getByTestId('list-mobile_gadget')).toBeVisible();
}

/** Records the JSON bodies the form sends. */
function captureWrites(page: Page) {
  const writes: { method: string; body: Body }[] = [];
  void page.route('**/api/mobile_gadget**', (route) => {
    const request = route.request();
    if (request.method() === 'POST' || request.method() === 'PUT') {
      writes.push({ method: request.method(), body: request.postDataJSON() as Body });
    }
    return route.continue();
  });
  return writes;
}

async function createGadget(page: Page, title: string, code: string) {
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_gadget')).toBeVisible();
  await page.getByTestId('field-title').fill(title);
  await page.getByTestId('gadget-code-input').fill(code);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('view-mobile_gadget')).toBeVisible();
}

test.describe('Hand-written native components', () => {
  test('a list component sits in the search / sort / filter row and receives the permissions', async ({ page }) => {
    await openList(page);
    const toolbar = page.getByTestId('list-filter-toggle').locator('xpath=..');
    await expect(toolbar.getByTestId('gadget-toolbar')).toHaveText('toolbar create=true');
  });

  test('the form replaces the field inputs and mounts the edit components after them, on create too', async ({ page }) => {
    await openList(page);
    await page.getByTestId('list-new').click();
    await expect(page.getByTestId('form-new-mobile_gadget')).toBeVisible();
    await expect(page.getByTestId('gadget-banner')).toHaveText('banner new');
    await expect(page.getByTestId('gadget-code-input')).toBeVisible();
    // The component replaces the whole input; the generic control is not drawn.
    await expect(page.getByTestId('field-code')).toHaveCount(0);
    await expect(page.getByTestId('field-pin')).toHaveCount(0);
    // An empty slot shows nothing to the user: no marker, no "not implemented" text.
    await expect(page.getByText(/GadgetNote|not implemented|TODO/i)).toHaveCount(0);
  });

  test('creating sends a changed custom field and leaves an untouched one out', async ({ page }) => {
    await openList(page);
    const writes = captureWrites(page);
    await createGadget(page, 'First gadget', 'ABC-1');
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('POST');
    expect(writes[0].body).toMatchObject({ title: 'First gadget', code: 'ABC-1' });
    expect(writes[0].body).not.toHaveProperty('pin');
  });

  test('the detail screen mounts the view component with the record, the permissions and the schema props', async ({ page }) => {
    await openList(page);
    await createGadget(page, 'Detail gadget', 'XYZ');
    await expect(page.getByTestId('gadget-summary')).toHaveText('summary Detail gadget tone=info update=true');
    // The field component replaces the whole row; a credential-style field (upsert only) is not listed.
    await expect(page.getByTestId('gadget-code-view')).toHaveText('code is XYZ');
    await expect(page.getByTestId('view-field-code')).toHaveCount(0);
    await expect(page.getByTestId('view-field-pin')).toHaveCount(0);
    await expect(page.getByTestId('view-field-title')).toHaveText('Detail gadget');
    await expect(page.getByText(/GadgetNote|not implemented|TODO/i)).toHaveCount(0);
  });

  test('editing shows the saved record to the edit component and sends only what changed', async ({ page }) => {
    await openList(page);
    await createGadget(page, 'Edit gadget', 'OLD');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_gadget')).toBeVisible();
    await expect(page.getByTestId('gadget-banner')).toHaveText('banner saved Edit gadget');
    await expect(page.getByTestId('gadget-code-input')).toHaveValue('OLD');

    const writes = captureWrites(page);
    // Only the title changes: the untouched custom fields stay out of the body.
    await page.getByTestId('field-title').fill('Edited gadget');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_gadget')).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('PUT');
    expect(writes[0].body).toMatchObject({ title: 'Edited gadget' });
    expect(writes[0].body).not.toHaveProperty('code');
    expect(writes[0].body).not.toHaveProperty('pin');

    // Changing the code sends it.
    await page.getByTestId('view-edit').click();
    await page.getByTestId('gadget-code-input').fill('NEW');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('gadget-code-view')).toHaveText('code is NEW');
    expect(writes[1].body).toMatchObject({ code: 'NEW' });
  });
});
