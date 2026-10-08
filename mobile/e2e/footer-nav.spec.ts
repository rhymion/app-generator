import { expect, test } from '@playwright/test';
import { login } from './helpers';

// The default schema declares one top-level group ("administration", the
// settings icon) holding the administration entities, plus the fixed search
// tab that is present whenever the app generates a search route.

test.describe('Footer navigation', () => {
  test('the footer shows the schema-driven group tab and the fixed search tab, icon first', async ({ page }) => {
    await login(page);
    const bar = page.getByTestId('footer-bar');
    const tabs = bar.locator('[data-testid^="footer-tab-"]');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveAttribute('data-testid', 'footer-tab-administration');
    await expect(tabs.nth(1)).toHaveAttribute('data-testid', 'footer-tab-search');
    // Icon first: each tab renders an icon glyph above its small label.
    await expect(tabs.nth(0).locator('svg, [role="img"], span').first()).toBeVisible();
    await expect(tabs.nth(0)).toContainText('Administration');
  });

  test('the footer scrolls horizontally so a tab past the visible width stays reachable', async ({ page }) => {
    // Two 76px tabs do not fit in 120px; the second can only be reached by scrolling.
    await page.setViewportSize({ width: 120, height: 700 });
    await login(page);
    const scroller = page.getByTestId('footer-bar').locator('div').filter({ has: page.getByTestId('footer-tab-search') }).first();
    const scrollable = await page.getByTestId('footer-bar').evaluate((bar) => {
      const nodes = Array.from(bar.querySelectorAll('div')) as HTMLElement[];
      return nodes.some((el) => el.scrollWidth > el.clientWidth + 1);
    });
    expect(scrollable).toBe(true);
    await scroller.getByTestId('footer-tab-search').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });

  test('selecting the search tab opens the search screen', async ({ page }) => {
    await login(page);
    await page.getByTestId('footer-tab-search').click();
    await expect(page.getByTestId('search-screen')).toBeVisible();
  });
});
