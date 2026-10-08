import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

// Runs only against the app built by scripts/run_mobile_entity_playwright.sh, whose schema adds
// mobile_thread (a commentable entity, list and view only). The script seeds two threads: the first
// has two comments (the second mentions the signed-in user) and a "like" reaction by that user on the
// first comment; the second has none.

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

  test('the thread offers no composer, edit or delete control', async ({ page }) => {
    await openThread(page, 'thread-seed-1');
    await expect(page.getByTestId('comment-thread').locator('input, textarea')).toHaveCount(0);
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
