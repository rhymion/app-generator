import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_ticket (a required foreign key to mobile_category that declares x-create-inline) and
// mobile_order (x-payment, answered by a fake hosted checkout page because PAYMENT_FAKE_STRIPE=1).

async function openNew(page: Page, entity: string) {
  await login(page);
  await page.getByTestId(`footer-tab-${entity}`).click();
  await expect(page.getByTestId(`list-${entity}`)).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId(`form-new-${entity}`)).toBeVisible();
}

const CREATE_MODAL = 'picker-create-modal-mobile_category_id';

test.describe('Create the referenced record in place (x-create-inline)', () => {
  test('creating in the target form selects the new record and keeps the hosting form values', async ({ page }) => {
    await openNew(page, 'mobile_ticket');
    await page.getByTestId('field-title').fill('Ticket with a new category');
    await page.getByTestId('picker-create-mobile_category_id').click();
    const modal = page.getByTestId(CREATE_MODAL);
    await expect(modal.getByTestId('form-new-mobile_category')).toBeVisible();
    await modal.getByTestId('field-name').fill('Fresh Category');
    await modal.getByTestId('form-save').click();
    await expect(page.getByTestId(CREATE_MODAL)).toHaveCount(0);
    await expect(page.getByTestId('picker-selected-mobile_category_id')).toHaveText('Fresh Category');
    await expect(page.getByTestId('picker-created-mobile_category_id')).toBeVisible();
    // the hosting form's unsaved value is still there, and it saves with the new record
    await expect(page.getByTestId('field-title')).toHaveValue('Ticket with a new category');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_ticket')).toBeVisible();
    await expect(page.getByTestId('view-field-mobile_category_id')).toHaveText('Fresh Category');
  });

  test('cancelling the target form leaves the field as it was', async ({ page }) => {
    await openNew(page, 'mobile_ticket');
    await page.getByTestId('field-title').fill('Cancelled create');
    await page.getByTestId('picker-create-mobile_category_id').click();
    await page.getByTestId(CREATE_MODAL).getByTestId('form-cancel').click();
    await expect(page.getByTestId(CREATE_MODAL)).toHaveCount(0);
    await expect(page.getByTestId('picker-selected-mobile_category_id')).toHaveText('-');
    await expect(page.getByTestId('picker-created-mobile_category_id')).toHaveCount(0);
    await expect(page.getByTestId('field-title')).toHaveValue('Cancelled create');
  });

  test("the target's own validation applies inside the form", async ({ page }) => {
    await openNew(page, 'mobile_ticket');
    await page.getByTestId('picker-create-mobile_category_id').click();
    await page.getByTestId(CREATE_MODAL).getByTestId('form-save').click();
    await expect(page.getByTestId(CREATE_MODAL).getByTestId('form-validation-error')).toBeVisible();
    await expect(page.getByTestId('picker-selected-mobile_category_id')).toHaveText('-');
  });

  test('no control is offered when the server says the caller may not create the target', async ({ page }) => {
    await page.route('**/api/mobile/permissions?entity=mobile_category', (route) =>
      route.fulfill({ json: { view: true, create: false, update: false, delete: false } }),
    );
    await openNew(page, 'mobile_ticket');
    await expect(page.getByTestId('picker-open-mobile_category_id')).toBeVisible();
    await expect(page.getByTestId('picker-create-mobile_category_id')).toHaveCount(0);
  });

  test('a foreign key that does not declare it offers no control', async ({ page }) => {
    await openNew(page, 'mobile_task');
    await expect(page.getByTestId('picker-open-mobile_group_id')).toBeVisible();
    await expect(page.getByTestId('picker-create-mobile_group_id')).toHaveCount(0);
  });
});

test.describe('Payment checkout (x-payment)', () => {
  test('saving opens the hosted checkout URL, then the record shows that the buyer returned', async ({ page }) => {
    await openNew(page, 'mobile_order');
    await page.getByTestId('field-name').fill('Paid order');
    const popup = page.waitForEvent('popup');
    await page.getByTestId('form-save').click();
    const checkout = await popup;
    expect(checkout.url()).toContain('/payment/success?session_id=');
    await expect(page.getByTestId('view-mobile_order')).toBeVisible();
    await expect(page.getByTestId('view-payment-returned')).toBeVisible();
    await expect(page.getByTestId('view-field-name')).toHaveText('Paid order');
  });
});
