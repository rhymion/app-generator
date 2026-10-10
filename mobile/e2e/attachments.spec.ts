import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_document: a required direct attachment field (contract) and an optional one (file). The
// form picks a file, uploads it (POST /api/upload), creates the attachment row (POST
// /api/attachment/direct) and submits the row's id with the entity, as the Web form does.

async function openNew(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_document').click();
  await expect(page.getByTestId('list-mobile_document')).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_document')).toBeVisible();
}

/** Taps a field's pick button and answers the system file chooser with one file. */
async function attach(page: Page, field: string, name: string, mimeType: string, content = 'hello') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId(`attachment-pick-${field}`).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(content) });
}

/** Records the JSON body of the next write to the entity's REST route. */
function captureWrite(page: Page, method: 'POST' | 'PUT') {
  const bodies: Record<string, unknown>[] = [];
  void page.route('**/api/mobile_document**', (route) => {
    const request = route.request();
    if (request.method() === method && /\/api\/mobile_document(\/[^/?]+)?$/.test(new URL(request.url()).pathname)) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
    return route.continue();
  });
  return bodies;
}

test.describe('Direct attachment fields', () => {
  test('a picked file is uploaded with the access token and its row id is saved with the record', async ({ page }) => {
    const bodies = captureWrite(page, 'POST');
    const calls: { url: string; authorization: string | undefined }[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === 'POST' && (pathname === '/api/upload' || pathname === '/api/attachment/direct')) {
        calls.push({ url: pathname, authorization: request.headers()['authorization'] });
      }
    });
    await openNew(page);
    await page.getByTestId('field-title').fill('Signed contract');
    await expect(page.getByTestId('attachment-name-contract_id')).toHaveText('-');
    await attach(page, 'contract_id', 'contract.pdf', 'application/pdf');
    await expect(page.getByTestId('attachment-name-contract_id')).toHaveText('contract.pdf');
    expect(calls.map((c) => c.url)).toEqual(['/api/upload', '/api/attachment/direct']);
    for (const call of calls) expect(call.authorization).toMatch(/^Bearer .+\..+\..+$/);

    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_document')).toBeVisible();
    await expect(page.getByTestId('view-field-contract_id')).toHaveText('contract.pdf');
    await expect(page.getByTestId('view-field-file_id')).toHaveText('-');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].contract_id).toEqual(expect.any(String));
    expect(bodies[0].contract_id).not.toBe('');
    // The optional field was left empty.
    expect(bodies[0].file_id).toBeNull();
  });

  test('a required attachment field blocks the save before any request', async ({ page }) => {
    let writes = 0;
    await page.route('**/api/mobile_document', (route) => {
      if (route.request().method() === 'POST') writes += 1;
      return route.continue();
    });
    await openNew(page);
    await page.getByTestId('field-title').fill('No contract yet');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toBeVisible();
    expect(writes).toBe(0);
  });

  test('an optional attachment can be cleared', async ({ page }) => {
    const bodies = captureWrite(page, 'POST');
    await openNew(page);
    await page.getByTestId('field-title').fill('Cleared file');
    await attach(page, 'contract_id', 'contract.pdf', 'application/pdf');
    await attach(page, 'file_id', 'scan.png', 'image/png');
    await expect(page.getByTestId('attachment-name-file_id')).toHaveText('scan.png');
    await page.getByTestId('attachment-clear-file_id').click();
    await expect(page.getByTestId('attachment-name-file_id')).toHaveText('-');
    await expect(page.getByTestId('attachment-clear-file_id')).toHaveCount(0);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_document')).toBeVisible();
    expect(bodies[0].file_id).toBeNull();
  });

  test('the edit form starts from the attached files and replacing one is saved', async ({ page }) => {
    const bodies = captureWrite(page, 'PUT');
    await openNew(page);
    await page.getByTestId('field-title').fill('Editable');
    await attach(page, 'contract_id', 'first.pdf', 'application/pdf');
    await attach(page, 'file_id', 'photo.png', 'image/png');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-file_id')).toHaveText('photo.png');

    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_document')).toBeVisible();
    await expect(page.getByTestId('attachment-name-contract_id')).toHaveText('first.pdf');
    await expect(page.getByTestId('attachment-name-file_id')).toHaveText('photo.png');

    await attach(page, 'contract_id', 'second.pdf', 'application/pdf');
    await page.getByTestId('attachment-clear-file_id').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_document')).toBeVisible();
    await expect(page.getByTestId('view-field-contract_id')).toHaveText('second.pdf');
    await expect(page.getByTestId('view-field-file_id')).toHaveText('-');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].file_id).toBeNull();
  });

  test("the server's refusal of a file type is shown and nothing is attached", async ({ page }) => {
    await openNew(page);
    await attach(page, 'file_id', 'run.sh', 'application/x-sh', 'echo hi');
    await expect(page.getByTestId('attachment-error-file_id')).toHaveText('Invalid file type.');
    await expect(page.getByTestId('attachment-name-file_id')).toHaveText('-');
  });

  test('the detail screen opens the attached file from its name', async ({ page, context }) => {
    await openNew(page);
    await page.getByTestId('field-title').fill('Openable');
    await attach(page, 'contract_id', 'openable.pdf', 'application/pdf');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-contract_id')).toHaveText('openable.pdf');
    const popup = context.waitForEvent('page');
    await page.getByTestId('view-field-contract_id').click();
    expect((await popup).url()).toContain('/uploads/');
    expect((await popup).url()).toContain('openable.pdf');
  });
});
