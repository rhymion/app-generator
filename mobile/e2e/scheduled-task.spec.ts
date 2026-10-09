import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Scheduled-task fixture spec (MODE=scheduled in scripts/run_mobile_entity_playwright.sh): the schema
// declares three tasks, st_first, st_second (depends on st_first) and st_boom (its handler always throws),
// and the test user holds the ScheduledTaskRunner role. The screen runs against the real routes unless a
// test says otherwise.

async function openScreen(page: Page) {
  await login(page);
  await page.getByTestId('footer-tab-administration').click();
  await page.getByTestId('nav-row-scheduled_task_run').click();
  await expect(page.getByTestId('list-scheduled_task_run')).toBeVisible();
}

test.describe.serial('Scheduled task administration screen', () => {
  test('the administration section lists the screen, which shows each task from the real overview route', async ({ page }) => {
    await openScreen(page);
    await expect(page.getByTestId('list-title')).toHaveText('Scheduled tasks');
    await expect(page.getByTestId('list-error')).toHaveCount(0);
    await expect(page.getByTestId('task-task-st_first')).toBeVisible();
    await expect(page.getByTestId('task-status-st_first')).toHaveText('Not run yet');
    await expect(page.getByTestId('task-status-st_second')).toHaveText('Blocked');
    await expect(page.getByTestId('task-why-st_second')).toHaveText('Waiting for st_first');
    // A blocked task with no record can be rerun or skipped, not marked resolved.
    await expect(page.getByTestId('task-rerun-st_second')).toBeVisible();
    await expect(page.getByTestId('task-skip-st_second')).toBeVisible();
    await expect(page.getByTestId('task-resolve-st_second')).toHaveCount(0);
  });

  test('rerun runs the task through the real action route and the row reloads as succeeded', async ({ page }) => {
    await openScreen(page);
    await page.getByTestId('task-rerun-st_first').click();
    await expect(page.getByTestId('scheduled-task-notice')).toHaveText('Done.');
    await expect(page.getByTestId('task-status-st_first')).toHaveText('Succeeded');
    // A succeeded task is final: no action is offered. Its dependant is no longer blocked.
    await expect(page.getByTestId('task-rerun-st_first')).toHaveCount(0);
    await expect(page.getByTestId('task-status-st_second')).toHaveText('Not run yet');
  });

  test('a failing task is shown as failed with its message, and skip without a reason is refused by the server', async ({ page }) => {
    await openScreen(page);
    await page.getByTestId('task-rerun-st_boom').click();
    await expect(page.getByTestId('task-status-st_boom')).toHaveText('Failed');
    await expect(page.getByTestId('task-message-st_boom')).not.toHaveText('');
    await page.getByTestId('task-skip-st_boom').click();
    await expect(page.getByTestId('scheduled-task-notice')).toHaveText('A reason is required.');
    await page.getByTestId('task-reason-st_boom').fill('known issue');
    await page.getByTestId('task-skip-st_boom').click();
    await expect(page.getByTestId('scheduled-task-notice')).toHaveText('Done.');
  });

  test('the date buttons request the previous and next business date', async ({ page }) => {
    const requested: (string | null)[] = [];
    await page.route('**/api/scheduled-task-runs?*', (route) => {
      requested.push(new URL(route.request().url()).searchParams.get('date'));
      return route.continue();
    });
    await openScreen(page);
    const today = await page.getByTestId('date-current').innerText();
    await page.getByTestId('date-prev').click();
    await expect(page.getByTestId('date-current')).not.toHaveText(today);
    await page.getByTestId('date-next').click();
    await expect(page.getByTestId('date-current')).toHaveText(today);
    expect(requested).toHaveLength(2);
    expect(requested[1]).toBe(today);
  });

  test('a caller without the operator role: the link is hidden, a refused overview shows the role message, a refused action shows the server answer', async ({ page }) => {
    await page.route('**/api/mobile/nav', (route) => route.fulfill({ json: { hiddenHrefs: ['/scheduled_task_run'] } }));
    await login(page);
    await page.getByTestId('footer-tab-administration').click();
    await expect(page.getByTestId('nav-row-user')).toBeVisible();
    await expect(page.getByTestId('nav-row-scheduled_task_run')).toHaveCount(0);

    // Reached anyway (a stale link), the server's 403 is what the screen reports.
    await page.route('**/api/scheduled-task-runs?*', (route) => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
    const origin = page.url().split('/').slice(0, 3).join('/');
    await page.goto(`${origin}/entity/scheduled_task_run`);
    await expect(page.getByTestId('list-error')).toContainText('ScheduledTaskRunner');
  });

  test('an action refused with 403 after the overview loaded is reported, not hidden', async ({ page }) => {
    await page.route('**/api/scheduled-task-runs/*/*', (route) => route.fulfill({ status: 403, json: { error: 'Forbidden' } }));
    await openScreen(page);
    const button = page.getByTestId('task-skip-st_second');
    await page.getByTestId('task-reason-st_second').fill('not mine');
    await button.click();
    await expect(page.getByTestId('scheduled-task-notice')).toHaveText("You need the 'ScheduledTaskRunner' role.");
  });
});
