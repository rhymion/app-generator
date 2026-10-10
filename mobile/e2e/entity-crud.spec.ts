import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh,
// whose schema adds mobile_note (full create / edit / delete) and mobile_log
// (list and view only, one seeded row) to the default one.

async function openList(page: Page, entity: string) {
  await login(page);
  await page.getByTestId(`footer-tab-${entity}`).click();
  await expect(page.getByTestId(`list-${entity}`)).toBeVisible();
}

async function createNote(page: Page, title: string) {
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId('form-new-mobile_note')).toBeVisible();
  await page.getByTestId('field-title').fill(title);
  await page.getByTestId('field-status-open').click();
  await page.getByTestId('field-priority').fill('3');
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('view-mobile_note')).toBeVisible();
}

test.describe('Native entity screens: create, edit, delete, list', () => {
  test('an entity with native screens opens its list from the footer', async ({ page }) => {
    await openList(page, 'mobile_note');
    await expect(page.getByTestId('list-title')).toHaveText('Mobile Note');
    await expect(page.getByTestId('list-new')).toBeVisible();
    await expect(page.getByTestId('list-page')).toHaveText('1 / 1');
  });

  test('the list pages through the zero-based REST pages', async ({ page }) => {
    const requested: string[] = [];
    await page.route('**/api/mobile_note?*', (route) => {
      const url = new URL(route.request().url());
      requested.push(url.searchParams.get('page') ?? '');
      const index = Number(url.searchParams.get('page'));
      const rows = Array.from({ length: 20 }, (_, i) => ({ id: `n${index}-${i}`, title: `Note ${index}-${i}`, status: 'open' }));
      return route.fulfill({ json: { rows, total: 45, page: index, pageSize: 20 } });
    });
    await openList(page, 'mobile_note');
    await expect(page.getByTestId('list-page')).toHaveText('1 / 3');
    await expect(page.getByTestId('list-prev')).toHaveAttribute('aria-disabled', 'true');
    await page.getByTestId('list-next').click();
    await expect(page.getByTestId('list-page')).toHaveText('2 / 3');
    await expect(page.getByTestId('list-row-n1-0')).toBeVisible();
    expect(requested).toEqual(['0', '1']);
  });

  test('creating a record shows it on the detail screen and in the list', async ({ page }) => {
    await openList(page, 'mobile_note');
    await createNote(page, 'Created from the phone');
    await expect(page.getByTestId('view-field-title')).toHaveText('Created from the phone');
    await expect(page.getByTestId('view-field-status')).toHaveText('open');
    await expect(page.getByTestId('view-field-priority')).toHaveText('3');
    await expect(page.getByTestId('view-field-is_done')).toHaveText('No');
    await page.getByTestId('view-back').click();
    await expect(page.getByText('Created from the phone')).toBeVisible();
  });

  test('the shared validation rejects a missing required field before any request', async ({ page }) => {
    await openList(page, 'mobile_note');
    let writes = 0;
    await page.route('**/api/mobile_note', (route) => {
      if (route.request().method() === 'POST') writes += 1;
      return route.continue();
    });
    await page.getByTestId('list-new').click();
    await page.getByTestId('field-status-open').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toHaveText('Title is required');
    expect(writes).toBe(0);
  });

  test('a date-time field rejects text that is not a date and sends no request', async ({ page }) => {
    await openList(page, 'mobile_note');
    let writes = 0;
    await page.route('**/api/mobile_note', (route) => {
      if (route.request().method() === 'POST') writes += 1;
      return route.continue();
    });
    await page.getByTestId('list-new').click();
    await page.getByTestId('field-title').fill('Bad time');
    await page.getByTestId('field-status-open').click();
    await expect(page.getByTestId('field-remind_at')).toHaveAttribute('placeholder', 'YYYY-MM-DDTHH:mm:ssZ');
    await page.getByTestId('field-remind_at').fill('test');
    await page.getByTestId('field-remind_at').blur();
    await expect(page.getByTestId('field-remind_at-error')).toBeVisible();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toHaveText('Remind At must be a valid date and time');
    expect(writes).toBe(0);
  });

  test('date, date-time and time inputs normalize typed values and save them', async ({ page }) => {
    await openList(page, 'mobile_note');
    await page.getByTestId('list-new').click();
    await page.getByTestId('field-title').fill('With times');
    await page.getByTestId('field-status-open').click();
    await page.getByTestId('field-remind_at').fill('2026-10-09T12:30:00.000Z');
    await page.getByTestId('field-remind_at').blur();
    await expect(page.getByTestId('field-remind_at')).toHaveValue('2026-10-09T12:30:00Z');
    await page.getByTestId('field-remind_time').fill('08:30');
    await page.getByTestId('field-remind_time').blur();
    await expect(page.getByTestId('field-remind_time')).toHaveValue('08:30:00');
    await page.getByTestId('field-due_on').fill('2026-02-30');
    await page.getByTestId('field-due_on').blur();
    await expect(page.getByTestId('field-due_on-error')).toBeVisible();
    await page.getByTestId('field-due_on-now').click();
    await expect(page.getByTestId('field-due_on-error')).toHaveCount(0);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_note')).toBeVisible();
    await expect(page.getByTestId('view-field-remind_time')).toHaveText('08:30:00');
  });

  test('editing a record updates the detail screen', async ({ page }) => {
    await openList(page, 'mobile_note');
    await createNote(page, 'Before edit');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('form-edit-mobile_note')).toBeVisible();
    await expect(page.getByTestId('field-title')).toHaveValue('Before edit');
    await page.getByTestId('field-title').fill('After edit');
    await page.getByTestId('field-is_done').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-title')).toHaveText('After edit');
    await expect(page.getByTestId('view-field-is_done')).toHaveText('Yes');
  });

  test('deleting a record asks for confirmation, then removes it from the list', async ({ page }) => {
    await openList(page, 'mobile_note');
    await createNote(page, 'Delete me');
    await page.getByTestId('view-delete').click();
    await expect(page.getByTestId('view-delete-confirm')).toBeVisible();
    await page.getByTestId('view-delete-confirm-no').click();
    await expect(page.getByTestId('view-delete-confirm')).toHaveCount(0);
    await page.getByTestId('view-delete').click();
    await page.getByTestId('view-delete-confirm-yes').click();
    await expect(page.getByTestId('list-mobile_note')).toBeVisible();
    await expect(page.getByText('Delete me')).toHaveCount(0);
  });

  test('a server-side rejection is shown with the shared error mapping', async ({ page }) => {
    await openList(page, 'mobile_note');
    await page.route('**/api/mobile_note', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 403, json: { error: 'Access denied', code: 'PERMISSION_DENIED' } })
        : route.continue(),
    );
    await page.getByTestId('list-new').click();
    await page.getByTestId('field-title').fill('Rejected');
    await page.getByTestId('field-status-open').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-error')).toHaveText('You do not have permission to perform this action.');
  });
});

test.describe('Native entity screens: permission-hidden actions', () => {
  test('the New action is hidden when the caller cannot create', async ({ page }) => {
    await page.route('**/api/mobile/permissions**', (route) =>
      route.fulfill({ json: { create: false, read: true, update: true, delete: true, import: false } }),
    );
    await openList(page, 'mobile_note');
    await expect(page.getByTestId('list-title')).toBeVisible();
    await expect(page.getByTestId('list-new')).toHaveCount(0);
  });

  test('a form opened without create permission shows no fields', async ({ page }) => {
    await page.route('**/api/mobile/permissions**', (route) =>
      route.fulfill({ json: { create: false, read: true, update: true, delete: true, import: false } }),
    );
    await login(page);
    await page.goto('/entity/mobile_note/new');
    await expect(page.getByTestId('form-forbidden')).toBeVisible();
    await expect(page.getByTestId('form-save')).toHaveCount(0);
  });

  test('Edit and Delete are hidden on a record the caller cannot change', async ({ page }) => {
    await openList(page, 'mobile_note');
    await createNote(page, 'Read only for me');
    const url = page.url();
    await page.route('**/capabilities', (route) =>
      route.fulfill({ json: { operations: { read: true, update: false, delete: false } } }),
    );
    await page.goto(url);
    await expect(page.getByTestId('view-mobile_note')).toBeVisible();
    await expect(page.getByTestId('view-edit')).toHaveCount(0);
    await expect(page.getByTestId('view-delete')).toHaveCount(0);
  });

  test('an entity that is list-and-view only never offers New, Edit or Delete', async ({ page }) => {
    await openList(page, 'mobile_log');
    await expect(page.getByTestId('list-new')).toHaveCount(0);
    await expect(page.getByTestId('list-row-log-seed-1')).toBeVisible();
    await page.getByTestId('list-row-log-seed-1').click();
    await expect(page.getByTestId('view-field-message')).toHaveText('Seeded log entry');
    await expect(page.getByTestId('view-edit')).toHaveCount(0);
    await expect(page.getByTestId('view-delete')).toHaveCount(0);
  });

  test('an entity without native screens still says so', async ({ page }) => {
    await login(page);
    await page.goto('/entity/user');
    await expect(page.getByTestId('entity-user')).toBeVisible();
  });
});
