import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Issue #1014: the header actions must be large enough to hit. A browser has no
// safe-area inset (it is 0), so this checks the sizes only; the inset itself is
// covered by code_generator/tests/test_mobile_header.py and needs a device to see.
const MIN_TOUCH_TARGET = 44;

test.describe('Header', () => {
  test('the actions are at least 44x44 and inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await login(page);
    const viewport = page.viewportSize()!;
    for (const id of ['header-locale', 'header-bell', 'header-signout']) {
      const target = page.getByTestId(id);
      // The language switch exists only when the app has more than one locale.
      if ((await target.count()) === 0) continue;
      const box = (await target.boundingBox())!;
      expect(box.width, `${id} width`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(box.height, `${id} height`).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
      expect(box.x, `${id} left`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${id} right`).toBeLessThanOrEqual(viewport.width);
    }
  });

  test('the title gives way before an action does', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await login(page);
    const bar = (await page.getByTestId('header-bar').boundingBox())!;
    const signout = (await page.getByTestId('header-signout').boundingBox())!;
    expect(signout.x + signout.width).toBeLessThanOrEqual(bar.x + bar.width);
  });
});
