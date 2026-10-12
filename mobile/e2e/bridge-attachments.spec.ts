import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_asset: an entity that owns attachments through the `attachable` bridge (images and files). The
// detail screen lists the attachments; the edit form adds, removes and reorders them and saves the whole
// set through PUT /api/mobile_asset/<id>/attachments after the record itself is saved.

type Put = { type: string; items: { id?: string; name: string; path: string }[] };

async function createAsset(page: Page, title: string) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_asset').click();
  await expect(page.getByTestId('list-mobile_asset')).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_asset')).toBeVisible();
  // As on the Web, attachments can only be added once the record exists.
  await expect(page.getByTestId('attachments-section')).toHaveCount(0);
  await page.getByTestId('field-title').fill(title);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
}

/** Taps a type's Add button and answers the system file chooser with one file. */
async function add(page: Page, type: 'image' | 'file', name: string, mimeType: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(`attachments-pick-${type}`).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from('hello') });
  await expect(page.getByTestId(`attachments-${type}`).getByText(name)).toBeVisible();
}

/** Records the JSON bodies sent to the record's attachments route. */
function capturePuts(page: Page) {
  const puts: Put[] = [];
  void page.route('**/api/mobile_asset/*/attachments', (route) => {
    if (route.request().method() === 'PUT') puts.push(route.request().postDataJSON() as Put);
    return route.continue();
  });
  return puts;
}

async function names(page: Page, type: 'image' | 'file') {
  return page.locator(`[data-testid^="attachment-name-${type}-"]`).allTextContents();
}

test.describe('Attachments of an entity with the attachable bridge', () => {
  test('files are added, reordered and removed on the edit form and listed on the detail screen', async ({ page }) => {
    const puts = capturePuts(page);
    await createAsset(page, 'Folder');
    await expect(page.getByTestId('attachments-section')).toBeVisible();
    await expect(page.getByTestId('attachment-name-file-0')).toHaveCount(0);

    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_asset')).toBeVisible();
    await add(page, 'file', 'a.pdf', 'application/pdf');
    await add(page, 'file', 'b.pdf', 'application/pdf');
    await add(page, 'file', 'c.pdf', 'application/pdf');
    expect(await names(page, 'file')).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    // Move b first, then remove c.
    await page.getByTestId('attachment-up-file-1').click();
    expect(await names(page, 'file')).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);
    await page.getByTestId('attachment-remove-file-2').click();
    expect(await names(page, 'file')).toEqual(['b.pdf', 'a.pdf']);

    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
    // One request for the type that changed, in the listed order, and none for the other.
    expect(puts).toHaveLength(1);
    expect(puts[0].type).toBe('file');
    expect(puts[0].items.map((i) => i.name)).toEqual(['b.pdf', 'a.pdf']);
    expect(await names(page, 'file')).toEqual(['b.pdf', 'a.pdf']);

    // Reopened, the edit form starts from the saved set; saving it unchanged sends nothing.
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_asset')).toBeVisible();
    expect(await names(page, 'file')).toEqual(['b.pdf', 'a.pdf']);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
    expect(puts).toHaveLength(1);
  });

  test('images and files are separate lists and only the changed type is saved', async ({ page }) => {
    const puts = capturePuts(page);
    await createAsset(page, 'Mixed');
    await page.getByTestId('view-edit').click();
    await add(page, 'image', 'photo.png', 'image/png');
    await add(page, 'file', 'doc.pdf', 'application/pdf');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
    expect(puts.map((p) => p.type).sort()).toEqual(['file', 'image']);
    expect(await names(page, 'image')).toEqual(['photo.png']);
    expect(await names(page, 'file')).toEqual(['doc.pdf']);

    await page.getByTestId('view-edit').click();
    await page.getByTestId('attachment-remove-image-0').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
    expect(puts).toHaveLength(3);
    expect(puts[2]).toMatchObject({ type: 'image', items: [] });
    await expect(page.getByTestId('attachments-image')).toHaveCount(0);
    expect(await names(page, 'file')).toEqual(['doc.pdf']);
  });

  test("the server's refusal of a file type is shown on the section and nothing is added", async ({ page }) => {
    await createAsset(page, 'Refused type');
    await page.getByTestId('view-edit').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('attachments-pick-file').click();
    await (await chooser).setFiles({ name: 'run.sh', mimeType: 'application/x-sh', buffer: Buffer.from('echo hi') });
    await expect(page.getByTestId('attachments-pick-error')).toHaveText('Invalid file type.');
    expect(await names(page, 'file')).toEqual([]);
  });

  test('a refused save keeps the record saved, shows the error on the section and keeps the edits', async ({ page }) => {
    await createAsset(page, 'Refused save');
    await page.getByTestId('view-edit').click();
    await add(page, 'file', 'keep.pdf', 'application/pdf');
    await page.route('**/api/mobile_asset/*/attachments', (route) =>
      route.fulfill({ status: 403, json: { error: 'Access denied: mobile_asset.update' } }),
    );
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('attachments-error')).toBeVisible();
    await expect(page.getByTestId('form-edit-mobile_asset')).toBeVisible();
    expect(await names(page, 'file')).toEqual(['keep.pdf']);
  });

  test('the detail screen offers no add, remove or reorder controls', async ({ page }) => {
    await createAsset(page, 'Read only');
    await page.getByTestId('view-edit').click();
    await add(page, 'file', 'x.pdf', 'application/pdf');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_asset')).toBeVisible();
    await expect(page.getByTestId('attachment-name-file-0')).toHaveText('x.pdf');
    await expect(page.getByTestId('attachments-pick-file')).toHaveCount(0);
    await expect(page.getByTestId('attachment-remove-file-0')).toHaveCount(0);
  });

  test('the attached file opens from its name', async ({ page, context }) => {
    await createAsset(page, 'Openable');
    await page.getByTestId('view-edit').click();
    await add(page, 'file', 'openable.pdf', 'application/pdf');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('attachment-name-file-0')).toHaveText('openable.pdf');
    const popup = context.waitForEvent('page');
    await page.getByTestId('attachment-name-file-0').click();
    expect((await popup).url()).toContain('openable.pdf');
  });
});
