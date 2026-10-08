import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_task (a required foreign key to mobile_group, a many-to-many to mobile_tag and a one-to-one
// selector to mobile_profile) and mobile_org_item (a foreign key to organization). The script seeds
// two groups, three tags, two profiles, and two organizations: only "Mobile Own Org" has the test
// user as a member.

async function openNew(page: Page, entity: string) {
  await login(page);
  await page.getByTestId(`footer-tab-${entity}`).click();
  await expect(page.getByTestId(`list-${entity}`)).toBeVisible();
  await page.getByTestId('list-new').click();
  await expect(page.getByTestId(`form-new-${entity}`)).toBeVisible();
}

/** Opens a field's picker, optionally searches, and taps one candidate. */
async function pick(page: Page, field: string, optionId: string, search?: string) {
  await page.getByTestId(`picker-open-${field}`).click();
  await expect(page.getByTestId(`picker-modal-${field}`)).toBeVisible();
  if (search !== undefined) await page.getByTestId('picker-search').fill(search);
  await page.getByTestId(`picker-option-${optionId}`).click();
}

/** Records the JSON body of the next write to an entity's REST route. */
function captureWrite(page: Page, entity: string, method: 'POST' | 'PUT') {
  const bodies: Record<string, unknown>[] = [];
  void page.route(`**/api/${entity}**`, (route) => {
    const request = route.request();
    if (request.method() === method && /\/api\/[a-z_]+(\/[^/?]+)?$/.test(new URL(request.url()).pathname)) {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
    return route.continue();
  });
  return bodies;
}

test.describe('Relation pickers: many-to-one foreign key', () => {
  test('selecting a candidate fills the field and the record shows its label', async ({ page }) => {
    const bodies = captureWrite(page, 'mobile_task', 'POST');
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('Pick a group');
    await expect(page.getByTestId('picker-selected-mobile_group_id')).toHaveText('-');
    await pick(page, 'mobile_group_id', 'group-seed-2');
    await expect(page.getByTestId('picker-modal-mobile_group_id')).toHaveCount(0);
    await expect(page.getByTestId('picker-selected-mobile_group_id')).toHaveText('Beta Group');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_task')).toBeVisible();
    await expect(page.getByTestId('view-field-mobile_group_id')).toHaveText('Beta Group');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].mobile_group_id).toBe('group-seed-2');
  });

  test('searching narrows the candidates, and the current selection is still offered', async ({ page }) => {
    await openNew(page, 'mobile_task');
    await pick(page, 'mobile_group_id', 'group-seed-2');
    await page.getByTestId('picker-open-mobile_group_id').click();
    await expect(page.getByTestId('picker-option-group-seed-1')).toBeVisible();
    await page.getByTestId('picker-search').fill('Alpha');
    await expect(page.getByTestId('picker-option-group-seed-1')).toBeVisible();
    // The selected record is returned although it does not match the text.
    await expect(page.getByTestId('picker-option-group-seed-2')).toBeVisible();
    await page.getByTestId('picker-search').fill('Nothing matches this');
    await expect(page.getByTestId('picker-option-group-seed-1')).toHaveCount(0);
    await page.getByTestId('picker-done').click();
    await expect(page.getByTestId('picker-modal-mobile_group_id')).toHaveCount(0);
  });

  test('the search carries the hosting entity and the form values the field names', async ({ page }) => {
    const urls: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/mobile_tag/options')) urls.push(request.url());
    });
    await openNew(page, 'mobile_task');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await page.getByTestId('picker-open-mobile_label_id').click();
    await expect(page.getByTestId('picker-option-tag-seed-1')).toBeVisible();
    const last = new URL(urls[urls.length - 1]);
    expect(last.searchParams.get('caller')).toBe('mobile_task');
    // The label field names the group field in its x-autocomplete-context.
    expect(JSON.parse(last.searchParams.get('context') as string)).toEqual({ mobile_group_id: 'group-seed-1' });
  });

  test('a required foreign key left empty is rejected by the shared validation before any request', async ({ page }) => {
    const bodies = captureWrite(page, 'mobile_task', 'POST');
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('No group');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('form-validation-error')).toHaveText('Mobile Group is required');
    expect(bodies).toHaveLength(0);
  });

  test('editing shows the saved selection and changing it updates the record', async ({ page }) => {
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('Move me');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-mobile_group_id')).toHaveText('Alpha Group');
    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('picker-selected-mobile_group_id')).toHaveText('Alpha Group');
    await pick(page, 'mobile_group_id', 'group-seed-2');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-mobile_group_id')).toHaveText('Beta Group');
  });

  test('a target the caller cannot read shows the field disabled with the shared message', async ({ page }) => {
    await page.route('**/api/mobile_group/options**', (route) =>
      route.fulfill({ status: 403, json: { error: 'Access denied' } }),
    );
    await openNew(page, 'mobile_task');
    await expect(page.getByTestId('picker-denied-mobile_group_id')).toBeVisible();
    await expect(page.getByTestId('picker-denied-mobile_group_id')).toContainText('You do not have permission to view mobile_group options.');
    await expect(page.getByTestId('picker-open-mobile_group_id')).toHaveCount(0);
  });
});

test.describe('Relation pickers: one-to-one selector', () => {
  test('an optional selector can be selected, then cleared, and is sent as null', async ({ page }) => {
    const bodies = captureWrite(page, 'mobile_task', 'POST');
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('Optional profile');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await pick(page, 'mobile_profile_id', 'profile-seed-1');
    await expect(page.getByTestId('picker-selected-mobile_profile_id')).toHaveText('Profile One');
    await page.getByTestId('picker-clear-mobile_profile_id').click();
    await expect(page.getByTestId('picker-selected-mobile_profile_id')).toHaveText('-');
    await expect(page.getByTestId('picker-clear-mobile_profile_id')).toHaveCount(0);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-mobile_task')).toBeVisible();
    await expect(page.getByTestId('view-field-mobile_profile_id')).toHaveText('-');
    expect(bodies[0].mobile_profile_id).toBeNull();
  });

  test('a selected profile is saved and shown by its label', async ({ page }) => {
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('With profile');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await pick(page, 'mobile_profile_id', 'profile-seed-2');
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-mobile_profile_id')).toHaveText('Profile Two');
  });

  test('a profile already linked to another record is rejected with the shared message', async ({ page }) => {
    await openNew(page, 'mobile_task');
    for (const title of ['Takes the profile', 'Wants the same profile']) {
      await page.getByTestId('field-title').fill(title);
      await pick(page, 'mobile_group_id', 'group-seed-1');
      await pick(page, 'mobile_profile_id', 'profile-seed-3');
      await page.getByTestId('form-save').click();
      if (title === 'Takes the profile') {
        await expect(page.getByTestId('view-mobile_task')).toBeVisible();
        await page.getByTestId('view-back').click();
        await page.getByTestId('list-new').click();
        await expect(page.getByTestId('form-new-mobile_task')).toBeVisible();
      }
    }
    await expect(page.getByTestId('form-error')).toContainText('is already linked to another record');
  });
});

test.describe('Relation pickers: many-to-many', () => {
  test('several records can be added and one removed before saving', async ({ page }) => {
    const bodies = captureWrite(page, 'mobile_task', 'POST');
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('Tagged');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await page.getByTestId('picker-open-tags').click();
    await page.getByTestId('picker-option-tag-seed-1').click();
    await page.getByTestId('picker-option-tag-seed-2').click();
    // The modal stays open while a set is chosen.
    await expect(page.getByTestId('picker-modal-tags')).toBeVisible();
    await page.getByTestId('picker-done').click();
    await expect(page.getByTestId('picker-chip-tags-tag-seed-1')).toContainText('Red');
    await expect(page.getByTestId('picker-chip-tags-tag-seed-2')).toContainText('Green');
    await page.getByTestId('picker-remove-tags-tag-seed-2').click();
    await expect(page.getByTestId('picker-chip-tags-tag-seed-2')).toHaveCount(0);
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-tags')).toHaveText('Red');
    expect(bodies[0].tags_ids).toEqual(['tag-seed-1']);
  });

  test('editing keeps the saved set, adds to it, and an emptied set is sent as an empty list', async ({ page }) => {
    await openNew(page, 'mobile_task');
    await page.getByTestId('field-title').fill('Edit tags');
    await pick(page, 'mobile_group_id', 'group-seed-1');
    await page.getByTestId('picker-open-tags').click();
    await page.getByTestId('picker-option-tag-seed-1').click();
    await page.getByTestId('picker-done').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-tags')).toHaveText('Red');

    await page.getByTestId('view-edit').click();
    await expect(page.getByTestId('picker-chip-tags-tag-seed-1')).toContainText('Red');
    await page.getByTestId('picker-open-tags').click();
    await page.getByTestId('picker-option-tag-seed-3').click();
    await page.getByTestId('picker-done').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-tags')).toContainText('Red');
    await expect(page.getByTestId('view-field-tags')).toContainText('Blue');

    const bodies = captureWrite(page, 'mobile_task', 'PUT');
    await page.getByTestId('view-edit').click();
    await page.getByTestId('picker-remove-tags-tag-seed-1').click();
    await page.getByTestId('picker-remove-tags-tag-seed-3').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-tags')).toHaveText('-');
    expect(bodies[0].tags_ids).toEqual([]);
  });
});

test.describe('Relation pickers: organization isolation', () => {
  test('only organizations the user belongs to are offered, by browsing and by searching', async ({ page }) => {
    await openNew(page, 'mobile_org_item');
    await page.getByTestId('field-name').fill('Scoped item');
    await page.getByTestId('picker-open-organization_id').click();
    await expect(page.getByTestId('picker-option-org-own')).toBeVisible();
    await expect(page.getByTestId('picker-option-org-foreign')).toHaveCount(0);
    await page.getByTestId('picker-search').fill('Foreign');
    await expect(page.getByTestId('picker-empty')).toBeVisible();
    await expect(page.getByTestId('picker-option-org-foreign')).toHaveCount(0);
    await page.getByTestId('picker-search').fill('Own');
    await page.getByTestId('picker-option-org-own').click();
    await page.getByTestId('form-save').click();
    await expect(page.getByTestId('view-field-organization_id')).toHaveText('Mobile Own Org');
  });
});
