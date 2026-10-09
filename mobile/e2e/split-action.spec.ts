import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_shipment (x-approval, and x-splittable on `quantity` with `mobile_group_id` named by every part)
// and which seeds two groups and these records, each with a pending approval round for a role the
// test administrator does not hold:
//   ship-rule      quantity 10; used by tests that do not complete a split
//   ship-split     quantity 10; split by the test that completes one
//   ship-approved  quantity 10; already approved, so the server refuses to split it
// Each test acts on its own record, so the tests do not depend on the order they run in.

async function openShipment(page: Page, id: string) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_shipment').click();
  await expect(page.getByTestId('list-mobile_shipment')).toBeVisible();
  await page.getByTestId(`list-row-${id}`).click();
  await expect(page.getByTestId('view-mobile_shipment')).toBeVisible();
}

/** RN-web marks a disabled Pressable with aria-disabled on a plain element, which `toBeDisabled` does not read. */
async function expectDisabled(page: Page, testId: string, disabled: boolean) {
  const control = page.getByTestId(testId);
  if (disabled) await expect(control).toHaveAttribute('aria-disabled', 'true');
  else await expect(control).not.toHaveAttribute('aria-disabled', 'true');
}

/** Types a part's quantity. */
async function setQuantity(page: Page, index: number, value: string) {
  await page.getByTestId(`split-quantity-${index}`).fill(value);
}

/** Picks a group for a part through the relation picker the form uses. */
async function pickGroup(page: Page, index: number, groupId: string) {
  await page.getByTestId(`split-field-${index}-mobile_group_id`).getByTestId('picker-open-mobile_group_id').click();
  await expect(page.getByTestId('picker-modal-mobile_group_id')).toBeVisible();
  await page.getByTestId(`picker-option-${groupId}`).click();
  // The closing modal fades out; wait until it is gone so the next picker's modal is the only one.
  await expect(page.getByTestId('picker-modal-mobile_group_id')).toHaveCount(0);
}

/** Records the path and JSON body of every split sent. */
function captureSplits(page: Page) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  void page.route('**/api/mobile_shipment/**/actions/split', (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      calls.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() as Record<string, unknown> });
    }
    return route.continue();
  });
  return calls;
}

test.describe('Split section on the detail screen', () => {
  test('Split is offered only while the parts add up to the record quantity', async ({ page }) => {
    await openShipment(page, 'ship-rule');
    await expect(page.getByTestId('split-section')).toHaveCount(0);
    await page.getByTestId('split-open').click();
    await expect(page.getByTestId('split-section')).toBeVisible();
    await expect(page.getByTestId('split-remaining')).toHaveText('Remaining: 10');
    await expect(page.getByTestId('split-part-0')).toBeVisible();
    await expect(page.getByTestId('split-part-1')).toBeVisible();
    await expectDisabled(page, 'split-confirm', true);
    await setQuantity(page, 0, '4');
    await expect(page.getByTestId('split-remaining')).toHaveText('Remaining: 6');
    await expectDisabled(page, 'split-confirm', true);
    await setQuantity(page, 1, '6');
    await expect(page.getByTestId('split-remaining')).toHaveText('Remaining: 0');
    await expectDisabled(page, 'split-confirm', false);
    await setQuantity(page, 1, '7');
    await expect(page.getByTestId('split-remaining')).toHaveText('Remaining: -1');
    await expectDisabled(page, 'split-confirm', true);
  });

  test('a part can be added and removed, but never fewer than two remain', async ({ page }) => {
    await openShipment(page, 'ship-rule');
    await page.getByTestId('split-open').click();
    await expectDisabled(page, 'split-remove-0', true);
    await expectDisabled(page, 'split-remove-1', true);
    await page.getByTestId('split-add-part').click();
    await expect(page.getByTestId('split-part-2')).toBeVisible();
    await expectDisabled(page, 'split-remove-2', false);
    await page.getByTestId('split-remove-2').click();
    await expect(page.getByTestId('split-part-2')).toHaveCount(0);
    await expectDisabled(page, 'split-remove-0', true);
  });

  test('cancel closes the section and a reopened one starts empty', async ({ page }) => {
    await openShipment(page, 'ship-rule');
    await page.getByTestId('split-open').click();
    await setQuantity(page, 0, '3');
    await page.getByTestId('split-cancel').click();
    await expect(page.getByTestId('split-section')).toHaveCount(0);
    await page.getByTestId('split-open').click();
    await expect(page.getByTestId('split-remaining')).toHaveText('Remaining: 10');
  });

  test('a part that names no group is refused by the server and the message is shown', async ({ page }) => {
    const calls = captureSplits(page);
    await openShipment(page, 'ship-rule');
    await page.getByTestId('split-open').click();
    await setQuantity(page, 0, '4');
    await setQuantity(page, 1, '6');
    await page.getByTestId('split-confirm').click();
    await expect(page.getByTestId('split-error')).toHaveText('Each part must specify mobile_group_id');
    await expect(page.getByTestId('split-section')).toBeVisible();
    expect(calls).toHaveLength(1);
  });

  test('the split is sent to the split route and the record shows it as split', async ({ page }) => {
    const calls = captureSplits(page);
    await openShipment(page, 'ship-split');
    await page.getByTestId('split-open').click();
    await setQuantity(page, 0, '4');
    await setQuantity(page, 1, '6');
    await pickGroup(page, 0, 'group-seed-1');
    await pickGroup(page, 1, 'group-seed-2');
    await expect(page.getByTestId('split-field-0-mobile_group_id').getByTestId('picker-selected-mobile_group_id')).toHaveText('Alpha Group');
    await expect(page.getByTestId('split-field-1-mobile_group_id').getByTestId('picker-selected-mobile_group_id')).toHaveText('Beta Group');
    await page.getByTestId('split-confirm').click();
    await expect(page.getByTestId('split-section')).toHaveCount(0);
    await expect(page.getByTestId('view-field-status')).toHaveText('split');
    expect(calls).toEqual([
      {
        path: '/api/mobile_shipment/ship-split/actions/split',
        body: {
          parts: [
            { quantity: 4, mobile_group_id: 'group-seed-1' },
            { quantity: 6, mobile_group_id: 'group-seed-2' },
          ],
        },
      },
    ]);
  });

  test('a record the server refuses to split keeps the section open with the server message', async ({ page }) => {
    await openShipment(page, 'ship-approved');
    await page.getByTestId('split-open').click();
    await setQuantity(page, 0, '4');
    await setQuantity(page, 1, '6');
    await pickGroup(page, 0, 'group-seed-1');
    await pickGroup(page, 1, 'group-seed-2');
    await page.getByTestId('split-confirm').click();
    await expect(page.getByTestId('split-error')).toHaveText('Cannot split an already-approved entity');
    await expect(page.getByTestId('split-section')).toBeVisible();
  });

  test('an entity without x-splittable shows no Split', async ({ page }) => {
    await login(page);
    await page.getByTestId('footer-tab-mobile_request').click();
    await page.getByTestId('list-row-req-stranger').click();
    await expect(page.getByTestId('view-mobile_request')).toBeVisible();
    await expect(page.getByTestId('split-open')).toHaveCount(0);
  });
});
