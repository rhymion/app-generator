import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_request (x-approval with submit_on, on_approved, on_rejected and on_withdrawn) and which seeds,
// for the test administrator (a member of "Mobile Approver" only):
//   req-approve / req-reject  one pending request each, for a role the administrator holds
//   req-withdraw              a pending request for another role; the administrator is the requestor
//   req-stranger              a pending request for another role; someone else is the requestor
//   req-decided               an approved request
//   req-staged                two stages: another role first, the administrator's role second
// Each test acts on its own record, so the tests do not depend on the order they run in.

async function openRecord(page: Page, id: string) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_request').click();
  await expect(page.getByTestId('list-mobile_request')).toBeVisible();
  await page.getByTestId(`list-row-${id}`).click();
  await expect(page.getByTestId('view-mobile_request')).toBeVisible();
  await expect(page.getByTestId('approval-section')).toBeVisible();
}

/** Records the path and JSON body of every approval action sent. */
function captureActions(page: Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  void page.route('**/api/approval_request/**', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      calls.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() as Record<string, unknown> });
    }
    return route.continue();
  });
  return calls;
}

test.describe('Approval section on the detail screen', () => {
  test('a request for another role offers this user no action, and the record stays editable', async ({ page }) => {
    await openRecord(page, 'req-stranger');
    await expect(page.getByTestId('approval-status-ar-stranger')).toHaveText('Pending');
    for (const control of ['approval-approve-ar-stranger', 'approval-reject-ar-stranger', 'approval-withdraw']) {
      await expect(page.getByTestId(control)).toHaveCount(0);
    }
    // The record is still editable while nothing has decided it.
    await expect(page.getByTestId('view-edit')).toBeVisible();
  });

  test('approve sends the message, the request becomes approved and the record is locked', async ({ page }) => {
    const calls = captureActions(page);
    await openRecord(page, 'req-approve');
    await expect(page.getByTestId('approval-withdraw')).toHaveCount(0);
    await page.getByTestId('approval-approve-ar-approve').click();
    await expect(page.getByTestId('approval-dialog')).toBeVisible();
    await page.getByTestId('approval-message').fill('Looks fine');
    await page.getByTestId('approval-confirm').click();
    await expect(page.getByTestId('approval-dialog')).toHaveCount(0);
    await expect(page.getByTestId('approval-status-ar-approve')).toHaveText('Approved');
    await expect(page.getByTestId('view-field-status')).toHaveText('approved');
    await expect(page.getByTestId('approval-approve-ar-approve')).toHaveCount(0);
    await expect(page.getByTestId('approval-reject-ar-approve')).toHaveCount(0);
    // An approved record can no longer be edited: the server reports it locked.
    await expect(page.getByTestId('view-edit')).toHaveCount(0);
    expect(calls).toEqual([{ path: '/api/approval_request/ar-approve/approve', body: { message: 'Looks fine' } }]);
  });

  test('reject sends the message, the reason and its kind', async ({ page }) => {
    const calls = captureActions(page);
    await openRecord(page, 'req-reject');
    await page.getByTestId('approval-reject-ar-reject').click();
    await page.getByTestId('approval-message').fill('Not now');
    await page.getByTestId('approval-reason-kind-1').click();
    await page.getByTestId('approval-reason').fill('Over budget');
    await page.getByTestId('approval-confirm').click();
    await expect(page.getByTestId('approval-dialog')).toHaveCount(0);
    await expect(page.getByTestId('approval-status-ar-reject')).toHaveText('Rejected');
    await expect(page.getByTestId('view-field-status')).toHaveText('rejected');
    expect(calls).toEqual([
      { path: '/api/approval_request/ar-reject/reject', body: { message: 'Not now', reason: 'Over budget', reason_kind: 1 } },
    ]);
  });

  test('the requestor can withdraw, and the record returns to its withdrawn value', async ({ page }) => {
    const calls = captureActions(page);
    await openRecord(page, 'req-withdraw');
    // The pending request belongs to another role: no approve or reject for this user.
    await expect(page.getByTestId('approval-approve-ar-withdraw')).toHaveCount(0);
    await expect(page.getByTestId('approval-reject-ar-withdraw')).toHaveCount(0);
    await page.getByTestId('approval-withdraw').click();
    await expect(page.getByTestId('approval-dialog')).toBeVisible();
    await page.getByTestId('approval-cancel').click();
    await expect(page.getByTestId('approval-dialog')).toHaveCount(0);
    expect(calls).toHaveLength(0);
    await page.getByTestId('approval-withdraw').click();
    await page.getByTestId('approval-confirm').click();
    await expect(page.getByTestId('approval-dialog')).toHaveCount(0);
    await expect(page.getByTestId('approval-status-ar-withdraw')).toHaveText('Withdrawn');
    await expect(page.getByTestId('view-field-status')).toHaveText('draft');
    await expect(page.getByTestId('approval-withdraw')).toHaveCount(0);
    expect(calls).toEqual([{ path: '/api/approval_request/ar-withdraw/withdraw', body: {} }]);
  });

  test('a decided request offers no action and the record cannot be edited', async ({ page }) => {
    await openRecord(page, 'req-decided');
    await expect(page.getByTestId('approval-status-ar-decided')).toHaveText('Approved');
    await expect(page.getByTestId('approval-approve-ar-decided')).toHaveCount(0);
    await expect(page.getByTestId('approval-withdraw')).toHaveCount(0);
    await expect(page.getByTestId('view-edit')).toHaveCount(0);
  });

  test('a later stage is not actionable before the earlier stage is approved', async ({ page }) => {
    await openRecord(page, 'req-staged');
    await expect(page.getByTestId('approval-row-ar-staged-1')).toBeVisible();
    await expect(page.getByTestId('approval-row-ar-staged-2')).toBeVisible();
    for (const id of ['ar-staged-1', 'ar-staged-2']) {
      await expect(page.getByTestId(`approval-approve-${id}`)).toHaveCount(0);
      await expect(page.getByTestId(`approval-reject-${id}`)).toHaveCount(0);
    }
  });

  test('the edit form does not offer values only the approval may write', async ({ page }) => {
    await openRecord(page, 'req-stranger');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('field-status-draft')).toBeVisible();
    await expect(page.getByTestId('field-status-submitted')).toBeVisible();
    await expect(page.getByTestId('field-status-approved')).toHaveCount(0);
    await expect(page.getByTestId('field-status-rejected')).toHaveCount(0);
  });
});
