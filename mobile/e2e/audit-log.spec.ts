import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Default-schema spec: the audit log is a built-in screen, listed under the
// administration group like the desktop sidebar lists it.

const ENTRY = {
  id: 'audit-1',
  target_table: 'role',
  target_id: 'role-1',
  action: 'UPDATE',
  actor_user_id: 'user-1',
  actor_user: { name: 'Admin' },
  metadata: { changed: ['name'] },
  created_at: '2026-10-08T10:00:00.000Z',
};

async function openAuditLog(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-administration').click();
  await page.getByTestId('nav-row-audit_log').click();
  await expect(page.getByTestId('list-audit_log')).toBeVisible();
}

test.describe('Audit log screens', () => {
  test('the administration section lists the audit log and opens the read-only list from the real route', async ({ page }) => {
    await openAuditLog(page);
    await expect(page.getByTestId('list-title')).toHaveText('Audit Log');
    await expect(page.getByTestId('list-error')).toHaveCount(0);
    await expect(page.getByTestId('list-new')).toHaveCount(0);
  });

  test('the list is requested newest first, zero-based, and pages through the REST pages', async ({ page }) => {
    const requested: { page: string | null; sort: string | null }[] = [];
    await page.route('**/api/audit_log?*', (route) => {
      const url = new URL(route.request().url());
      requested.push({ page: url.searchParams.get('page'), sort: url.searchParams.get('sort') });
      const index = Number(url.searchParams.get('page'));
      const rows = Array.from({ length: 20 }, (_, i) => ({ ...ENTRY, id: `a${index}-${i}` }));
      return route.fulfill({ json: { rows, total: 45, page: index, pageSize: 20 } });
    });
    await openAuditLog(page);
    await expect(page.getByTestId('list-page')).toHaveText('1 / 3');
    await page.getByTestId('list-next').click();
    await expect(page.getByTestId('list-page')).toHaveText('2 / 3');
    await expect(page.getByTestId('list-row-a1-0')).toBeVisible();
    expect(requested).toEqual([
      { page: '0', sort: 'created_at:desc' },
      { page: '1', sort: 'created_at:desc' },
    ]);
  });

  test('a row opens the read-only detail, which shows the entry and its metadata', async ({ page }) => {
    await page.route('**/api/audit_log?*', (route) =>
      route.fulfill({ json: { rows: [ENTRY], total: 1, page: 0, pageSize: 20 } }),
    );
    await page.route('**/api/audit_log/audit-1', (route) => route.fulfill({ json: ENTRY }));
    await openAuditLog(page);
    await expect(page.getByTestId('list-cell-audit-1-action')).toHaveText('UPDATE');
    await page.getByTestId('list-row-audit-1').click();
    await expect(page.getByTestId('view-audit_log')).toBeVisible();
    await expect(page.getByTestId('view-field-action')).toHaveText('UPDATE');
    await expect(page.getByTestId('view-field-target_table')).toHaveText('role');
    await expect(page.getByTestId('view-field-actor_user')).toHaveText('Admin');
    await expect(page.getByTestId('view-field-metadata')).toContainText('"changed"');
    await expect(page.getByTestId('view-edit')).toHaveCount(0);
    await expect(page.getByTestId('view-delete')).toHaveCount(0);
    await page.getByTestId('view-back').click();
    await expect(page.getByTestId('list-audit_log')).toBeVisible();
  });

  test('an entry that no longer exists says so', async ({ page }) => {
    await page.route('**/api/audit_log?*', (route) =>
      route.fulfill({ json: { rows: [ENTRY], total: 1, page: 0, pageSize: 20 } }),
    );
    await page.route('**/api/audit_log/audit-1', (route) => route.fulfill({ status: 404, json: { error: 'Not found' } }));
    await openAuditLog(page);
    await page.getByTestId('list-row-audit-1').click();
    await expect(page.getByTestId('view-missing')).toBeVisible();
  });

  test('a user without read permission does not see the link, and a refused request shows the permission message', async ({ page }) => {
    await page.route('**/api/mobile/nav', (route) => route.fulfill({ json: { hiddenHrefs: ['/audit_log'] } }));
    await login(page);
    await page.getByTestId('footer-tab-administration').click();
    await expect(page.getByTestId('nav-row-user')).toBeVisible();
    await expect(page.getByTestId('nav-row-audit_log')).toHaveCount(0);

    // Reached anyway (a stale link), the server's 403 is what the screen reports.
    await page.route('**/api/audit_log?*', (route) => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
    await page.goto(`${page.url().split('/').slice(0, 3).join('/')}/entity/audit_log`);
    await expect(page.getByTestId('list-error')).toBeVisible();
  });
});
