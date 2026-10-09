import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh (fixture mode): mobile_note has
// full CRUD, a text title, an enum status and an integer priority.

async function openList(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_note').click();
  await expect(page.getByTestId('list-mobile_note')).toBeVisible();
}

async function createNote(page: Page, title: string, status: 'open' | 'closed', priority: string) {
  await page.getByTestId('list-new').click();
  await page.getByTestId('field-title').fill(title);
  await page.getByTestId(`field-status-${status}`).click();
  await page.getByTestId('field-priority').fill(priority);
  await page.getByTestId('form-save').click();
  await expect(page.getByTestId('view-mobile_note')).toBeVisible();
  await page.getByTestId('view-back').click();
  await expect(page.getByTestId('list-mobile_note')).toBeVisible();
}

const titles = (page: Page) => page.locator('[data-testid^="list-cell-"][data-testid$="-title"]');

async function seed(page: Page, prefix: string) {
  await createNote(page, `${prefix} bravo`, 'closed', '2');
  await createNote(page, `${prefix} alpha`, 'open', '3');
  await createNote(page, `${prefix} charlie`, 'open', '1');
}

test.describe('Native list: sort, filter and search', () => {
  test('sorting sends the REST sort parameter and orders the rows', async ({ page }) => {
    await openList(page);
    await seed(page, 'Sort');
    await page.getByTestId('list-search').fill('Sort ');
    await expect(titles(page)).toHaveCount(3);
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/mobile_note?')) requests.push(new URL(request.url()).searchParams.get('sort') ?? '');
    });
    await page.getByTestId('list-sort-toggle').click();
    await page.getByTestId('list-sort-title').click();
    await expect(titles(page).first()).toHaveText('Sort alpha');
    await page.getByTestId('list-sort-title').click();
    await expect(titles(page).first()).toHaveText('Sort charlie');
    expect(requests).toContain('title:asc');
    expect(requests).toContain('title:desc');
  });

  test('a filter narrows the list and clearing it restores the rows', async ({ page }) => {
    await openList(page);
    await seed(page, 'Filter');
    await page.getByTestId('list-search').fill('Filter ');
    await expect(titles(page)).toHaveCount(3);
    await page.getByTestId('list-filter-toggle').click();
    await page.getByTestId('list-filter-status-closed').click();
    await expect(titles(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Filter bravo');
    await page.getByTestId('list-filter-clear').click();
    await expect(titles(page)).toHaveCount(3);
  });

  test('the search box matches the title column through the filter parameter', async ({ page }) => {
    await openList(page);
    await seed(page, 'Search');
    let param = '';
    page.on('request', (request) => {
      if (request.url().includes('/api/mobile_note?')) param = new URL(request.url()).searchParams.get('f.title') ?? param;
    });
    await page.getByTestId('list-search').fill('Search charl');
    await expect(titles(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Search charlie');
    expect(param).toBe('Search charl');
  });
});

test.describe('Native list: bulk delete', () => {
  async function select(page: Page, title: string) {
    const row = page.getByText(title, { exact: true });
    await row.hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
  }

  test('long-press selects, the confirmation matches the single delete, the bulk route removes the rows', async ({ page }) => {
    await openList(page);
    await seed(page, 'Bulk');
    await page.getByTestId('list-search').fill('Bulk ');
    await expect(titles(page)).toHaveCount(3);
    let bulkBody = '';
    await page.route('**/api/mobile_note/bulk', (route) => {
      bulkBody = route.request().postData() ?? '';
      return route.continue();
    });
    await select(page, 'Bulk alpha');
    await expect(page.getByTestId('list-selection-bar')).toBeVisible();
    await expect(page.getByTestId('list-selected-count')).toHaveText('1 selected');
    await page.getByText('Bulk bravo', { exact: true }).click();
    await expect(page.getByTestId('list-selected-count')).toHaveText('2 selected');
    await page.getByTestId('list-bulk-delete').click();
    await expect(page.getByTestId('list-bulk-confirm')).toContainText('Are you sure you want to delete this');
    await page.getByTestId('list-bulk-confirm-no').click();
    await expect(page.getByTestId('list-bulk-confirm')).toHaveCount(0);
    await page.getByTestId('list-bulk-delete').click();
    await page.getByTestId('list-bulk-confirm-yes').click();
    await expect(titles(page)).toHaveCount(1);
    await expect(titles(page).first()).toHaveText('Bulk charlie');
    await expect(page.getByTestId('list-selection-bar')).toHaveCount(0);
    expect(JSON.parse(bulkBody)).toHaveLength(2);
  });

  test('a record the server refuses stays selected with the permission message', async ({ page }) => {
    await openList(page);
    await seed(page, 'Refuse');
    await page.getByTestId('list-search').fill('Refuse ');
    await expect(titles(page)).toHaveCount(3);
    await page.route('**/api/mobile_note/bulk', async (route) => {
      const ids = (JSON.parse(route.request().postData() ?? '[]') as { id: string }[]).map((item) => item.id);
      return route.fulfill({
        status: 207,
        json: {
          results: ids.map((_, index) => (index === 0 ? { index, success: false, error: 'Access denied: x' } : { index, success: true, data: null })),
          summary: { total: ids.length, succeeded: ids.length - 1, failed: 1 },
        },
      });
    });
    await select(page, 'Refuse alpha');
    await page.getByText('Refuse bravo', { exact: true }).click();
    await page.getByTestId('list-bulk-delete').click();
    await page.getByTestId('list-bulk-confirm-yes').click();
    await expect(page.getByTestId('list-bulk-error')).toHaveText('You do not have permission to perform this action.');
    await expect(page.getByTestId('list-selected-count')).toHaveText('1 selected');
  });

  test('the Delete selection is unavailable without delete permission', async ({ page }) => {
    await page.route('**/api/mobile/permissions**', (route) =>
      route.fulfill({ json: { create: true, read: true, update: true, delete: false, import: false } }),
    );
    await openList(page);
    await createNote(page, 'No delete', 'open', '1');
    await page.getByText('No delete', { exact: true }).first().hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await expect(page.getByTestId('list-selection-bar')).toHaveCount(0);
  });
});
