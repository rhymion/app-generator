import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_thread (a commentable entity, list and view only). The script seeds two threads: the first
// has two comments (the second mentions the signed-in user) and a "like" reaction by that user on the
// first comment; the second has none. thread-seed-3 is empty and takes the comments the specs write;
// thread-seed-4 holds comments to edit and delete (one written by another user, who is also the
// mention candidate "Other Author" in the signed-in user's organization).

async function openThread(page: Page, id: string) {
  await login(page);
  await page.getByTestId('footer-tab-mobile_thread').click();
  await expect(page.getByTestId('list-mobile_thread')).toBeVisible();
  await page.getByTestId(`list-row-${id}`).click();
  await expect(page.getByTestId('view-mobile_thread')).toBeVisible();
}

test.describe('Comment thread on the detail screen', () => {
  test('lists the comments of the record in order, with the author', async ({ page }) => {
    await openThread(page, 'thread-seed-1');
    await expect(page.getByTestId('comment-thread')).toBeVisible();
    await expect(page.getByTestId('comment-message-comment-seed-1')).toHaveText('First comment');
    await expect(page.getByTestId('comment-meta-comment-seed-1')).toContainText('Test Admin');
    const ids = await page.locator('[data-testid^="comment-comment-seed-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')));
    expect(ids).toEqual(['comment-comment-seed-1', 'comment-comment-seed-2']);
  });

  test('a mention is shown as the mentioned user name, not as the stored marker', async ({ page }) => {
    await openThread(page, 'thread-seed-1');
    const message = page.getByTestId('comment-message-comment-seed-2');
    await expect(message).toContainText('Second comment, cc @');
    await expect(message).not.toContainText('user_id');
    await expect(message).toContainText('please look');
  });

  test('a record without comments shows an empty thread', async ({ page }) => {
    await openThread(page, 'thread-seed-2');
    await expect(page.getByTestId('comment-thread')).toBeVisible();
    await expect(page.locator('[data-testid^="comment-comment-"]')).toHaveCount(0);
  });
});

test.describe('Reactions on comments', () => {
  test('shows the counts and marks the reaction the signed-in user already made', async ({ page }) => {
    await openThread(page, 'thread-seed-1');
    const like = page.getByTestId('reaction-comment-seed-1-like');
    await expect(like).toContainText('Like 1');
    await expect(like).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('reaction-comment-seed-1-love')).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByTestId('reaction-comment-seed-2-like')).toHaveAttribute('aria-selected', 'false');
  });

  test('tapping adds a reaction and tapping again removes it, through the reactions route', async ({ page }) => {
    const posts: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/api/comment/comment-seed-2/reactions/toggle')) {
        posts.push(request.postDataJSON());
      }
    });
    await openThread(page, 'thread-seed-1');
    const love = page.getByTestId('reaction-comment-seed-2-love');
    await love.click();
    await expect(love).toContainText('Love 1');
    await expect(love).toHaveAttribute('aria-selected', 'true');
    await love.click();
    await expect(love).toHaveAttribute('aria-selected', 'false');
    await expect(love).not.toContainText('1');
    expect(posts).toEqual([{ type: 'love' }, { type: 'love' }]);
  });

  test('a reaction survives leaving and reopening the screen', async ({ page }) => {
    await openThread(page, 'thread-seed-1');
    const laugh = page.getByTestId('reaction-comment-seed-1-laugh');
    await laugh.click();
    await expect(laugh).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('view-back').click();
    await page.getByTestId('list-row-thread-seed-1').click();
    await expect(page.getByTestId('reaction-comment-seed-1-laugh')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('reaction-comment-seed-1-laugh').click();
    await expect(page.getByTestId('reaction-comment-seed-1-laugh')).toHaveAttribute('aria-selected', 'false');
  });
});

const ADD_URL = (id: string) => `/api/mobile_thread/${id}/comments`;

type WriteRequest = { method: string; url: string; body: unknown };

function recordWrites(page: Page): WriteRequest[] {
  const writes: WriteRequest[] = [];
  page.on('request', (request) => {
    if (['POST', 'PATCH', 'DELETE'].includes(request.method()) && request.url().includes('/comments')) {
      writes.push({ method: request.method(), url: new URL(request.url()).pathname, body: request.postDataJSON?.() ?? null });
    }
  });
  return writes;
}

test.describe('Adding a comment', () => {
  test('sends the message to the comment route and shows the new comment', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-3');
    await page.getByTestId('comment-new-input').fill('  Hello from mobile  ');
    await page.getByTestId('comment-new-submit').click();
    await expect(page.getByText('Hello from mobile', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ method: 'POST', url: ADD_URL('thread-seed-3'), body: { message: 'Hello from mobile' } }]);
    await expect(page.getByTestId('comment-new-input')).toHaveValue('');
  });

  test('keeps the submit button disabled while the box is blank', async ({ page }) => {
    await openThread(page, 'thread-seed-3');
    await expect(page.getByTestId('comment-new-submit')).toBeDisabled();
    await page.getByTestId('comment-new-input').fill('   ');
    await expect(page.getByTestId('comment-new-submit')).toBeDisabled();
    await page.getByTestId('comment-new-input').fill('x');
    await expect(page.getByTestId('comment-new-submit')).toBeEnabled();
  });

  test('shows the server refusal and keeps the typed text', async ({ page }) => {
    await page.route('**/api/mobile_thread/thread-seed-3/comments', (route) =>
      route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied: mobile_thread.update' }) }),
    );
    await openThread(page, 'thread-seed-3');
    await page.getByTestId('comment-new-input').fill('Refused comment');
    await page.getByTestId('comment-new-submit').click();
    await expect(page.getByTestId('comment-new-error')).toHaveText('You do not have permission to perform this action.');
    await expect(page.getByTestId('comment-new-input')).toHaveValue('Refused comment');
  });

  test('offers no comment box when the record cannot be updated', async ({ page }) => {
    await page.route('**/api/mobile_thread/thread-seed-3/capabilities', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({ response, json: { ...body, operations: { ...body.operations, update: false } } });
    });
    await openThread(page, 'thread-seed-3');
    await expect(page.getByTestId('comment-thread')).toBeVisible();
    await expect(page.getByTestId('comment-new-composer')).toHaveCount(0);
  });
});

test.describe('@-mentions in the comment box', () => {
  test('looks users up while typing @ and sends the mention as a marker', async ({ page }) => {
    const writes = recordWrites(page);
    const searches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/mention/users')) searches.push(new URL(request.url()).searchParams.get('q') ?? '');
    });
    await openThread(page, 'thread-seed-3');
    const input = page.getByTestId('comment-new-input');
    await input.fill('Hi @Oth');
    await page.getByTestId('comment-new-mention-user-other').click();
    expect(searches).toContain('Oth');
    await expect(input).toHaveValue('Hi @Other Author ');
    await input.press('End');
    await input.pressSequentially('please look');
    await page.getByTestId('comment-new-submit').click();
    await expect(page.getByText('Hi @Other Author please look', { exact: true })).toBeVisible();
    expect(writes).toEqual([
      { method: 'POST', url: ADD_URL('thread-seed-3'), body: { message: 'Hi @[user_id:user-other] please look' } },
    ]);
  });

  test('an @name that was not picked is sent as plain text', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-3');
    await page.getByTestId('comment-new-input').fill('cc @Other Author by hand');
    await page.getByTestId('comment-new-submit').click();
    await expect(page.getByText('cc @Other Author by hand', { exact: true })).toBeVisible();
    expect(writes).toEqual([{ method: 'POST', url: ADD_URL('thread-seed-3'), body: { message: 'cc @Other Author by hand' } }]);
  });

  test('an e-mail address does not open the lookup', async ({ page }) => {
    await openThread(page, 'thread-seed-3');
    await page.getByTestId('comment-new-input').fill('write to a@example.com');
    await expect(page.getByTestId('comment-new-mentions')).toHaveCount(0);
  });

  test('says suggestions are unavailable when the caller may not read users', async ({ page }) => {
    await page.route('**/api/mention/users**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ options: [], permissionDenied: true }) }),
    );
    await openThread(page, 'thread-seed-3');
    await page.getByTestId('comment-new-input').fill('@x');
    await expect(page.getByTestId('comment-new-mentions-denied')).toBeVisible();
  });
});

test.describe('Editing and deleting comments', () => {
  test('edits the signed-in user\'s comment through the route', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-4');
    await page.getByTestId('comment-edit-comment-edit-1').click();
    const input = page.getByTestId('comment-edit-comment-edit-1-input');
    await expect(input).toHaveValue('Editable comment');
    await input.fill('Edited comment');
    await page.getByTestId('comment-edit-comment-edit-1-submit').click();
    await expect(page.getByTestId('comment-message-comment-edit-1')).toHaveText('Edited comment');
    expect(writes).toEqual([
      { method: 'PATCH', url: `${ADD_URL('thread-seed-4')}/comment-edit-1`, body: { message: 'Edited comment' } },
    ]);
  });

  test('editing keeps the mentions of the comment as markers', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-4');
    await expect(page.getByTestId('comment-message-comment-edit-2')).toHaveText('Look at this, @Other Author please');
    await page.getByTestId('comment-edit-comment-edit-2').click();
    const input = page.getByTestId('comment-edit-comment-edit-2-input');
    await expect(input).toHaveValue('Look at this, @Other Author please');
    await input.press('End');
    await input.pressSequentially(' thanks');
    await page.getByTestId('comment-edit-comment-edit-2-submit').click();
    await expect(page.getByTestId('comment-message-comment-edit-2')).toHaveText('Look at this, @Other Author please thanks');
    expect(writes).toEqual([
      {
        method: 'PATCH',
        url: `${ADD_URL('thread-seed-4')}/comment-edit-2`,
        body: { message: 'Look at this, @[user_id:user-other] please thanks' },
      },
    ]);
  });

  test('cancelling an edit changes nothing', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-4');
    await page.getByTestId('comment-edit-comment-del-2').click();
    await page.getByTestId('comment-edit-comment-del-2-input').fill('Never saved');
    await page.getByTestId('comment-edit-comment-del-2-cancel').click();
    await expect(page.getByTestId('comment-message-comment-del-2')).toHaveText('Keep me');
    expect(writes).toEqual([]);
  });

  test('a comment written by someone else can be deleted but not edited', async ({ page }) => {
    await openThread(page, 'thread-seed-4');
    await expect(page.getByTestId('comment-message-comment-other')).toHaveText('Written by someone else');
    await expect(page.getByTestId('comment-edit-comment-other')).toHaveCount(0);
    await expect(page.getByTestId('comment-delete-comment-other')).toBeVisible();
  });

  test('deleting asks for confirmation, then removes the comment through the route', async ({ page }) => {
    const writes = recordWrites(page);
    await openThread(page, 'thread-seed-4');
    await page.getByTestId('comment-delete-comment-del-1').click();
    await page.getByTestId('comment-delete-cancel-comment-del-1').click();
    await expect(page.getByTestId('comment-message-comment-del-1')).toBeVisible();
    expect(writes).toEqual([]);
    await page.getByTestId('comment-delete-comment-del-1').click();
    await page.getByTestId('comment-delete-confirm-comment-del-1').click();
    await expect(page.getByTestId('comment-comment-del-1')).toHaveCount(0);
    expect(writes).toEqual([{ method: 'DELETE', url: `${ADD_URL('thread-seed-4')}/comment-del-1`, body: null }]);
  });

  test('shows the server refusal of a delete and keeps the comment', async ({ page }) => {
    await page.route('**/api/mobile_thread/thread-seed-4/comments/comment-del-2', (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Access denied' }) })
        : route.continue(),
    );
    await openThread(page, 'thread-seed-4');
    await page.getByTestId('comment-delete-comment-del-2').click();
    await page.getByTestId('comment-delete-confirm-comment-del-2').click();
    await expect(page.getByTestId('comment-action-error-comment-del-2')).toHaveText('You do not have permission to perform this action.');
    await expect(page.getByTestId('comment-message-comment-del-2')).toBeVisible();
  });
});
