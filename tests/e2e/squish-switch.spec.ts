import { expect, test } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

test('the single clock switch slides, saves the theme and has no duplicate controls', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockCloud(page);
  await page.goto('/#planner');
  const toggle = page
    .locator('.planner-moment')
    .getByRole('switch', { name: '밤 공부', exact: true });
  await toggle.evaluate((el) => {
    const samples = new Set<string>();
    (window as unknown as { squishSamples: Set<string> }).squishSamples = samples;
    const thumb = el.querySelector<HTMLElement>('.squish-switch__thumb')!;
    const observer = new MutationObserver(() => samples.add(thumb.style.transform));
    observer.observe(thumb, { attributes: true, attributeFilter: ['style'] });
    setTimeout(() => observer.disconnect(), 1800);
  });
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await expect(page.locator('.planner-moment').getByRole('switch')).toBeChecked();
  await expect
    .poll(() =>
      toggle
        .locator('.squish-switch__thumb')
        .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41),
    )
    .toBeCloseTo(42, 1);
  expect(
    await page.evaluate(
      () => (window as unknown as { squishSamples: Set<string> }).squishSamples.size,
    ),
  ).toBeGreaterThan(1);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.locator('.atmosphere-settings')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.getByRole('switch')).toHaveCount(1);
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  expect(errors).toEqual([]);
});

test('mobile touch toggles once; drag cancellation and keyboard use preserve the correct theme', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockCloud(page);
  await page.goto('/#planner');
  const toggle = page.locator('.planner-moment').getByRole('switch');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await toggle.scrollIntoViewIfNeeded();
  const box = (await toggle.boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(toggle).toBeChecked();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + 57, y }],
  });
  for (let step = 1; step <= 5; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: box.x + 57 - step * 8, y }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(toggle).toBeChecked();
  await toggle.focus();
  await page.keyboard.press(' ');
  await expect(toggle).not.toBeChecked();
  await expect(toggle.locator('.squish-switch__thumb')).toHaveCSS(
    'transform',
    'matrix(1, 0, 0, 1, 4, 0)',
  );
  await expect(page.locator('.topbar').getByRole('switch')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/squish-mobile.png', fullPage: true });
});
