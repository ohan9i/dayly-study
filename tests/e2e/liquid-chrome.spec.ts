import { expect, test, type Page } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

declare global {
  interface Window {
    chromeDraws: number;
    restoreChrome?: () => void;
  }
}

async function observeDraws(page: Page) {
  await page.addInitScript(() => {
    window.chromeDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      if ((this.canvas as HTMLCanvasElement).classList.contains('liquid-chrome__canvas'))
        window.chromeDraws++;
      return draw.apply(this, args);
    };
  });
}
const draws = (page: Page) => page.evaluate(() => window.chromeDraws);

test('chrome starts after the book opens, replaces the video, and leaves controls usable', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  const cloudAssets: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('planner-clouds')) cloudAssets.push(r.url());
  });
  await page.goto('/');
  await expect(page.locator('.welcome-runway')).toBeVisible();
  await expect(page.locator('.liquid-chrome canvas')).toHaveCount(0);
  expect(await draws(page)).toBe(0);
  await page.mouse.wheel(0, 200);
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await expect.poll(() => draws(page)).toBeGreaterThan(1);
  expect(cloudAssets).toHaveLength(0);
  await expect(page.locator('.planner-background video, .planner-background img')).toHaveCount(0);
  await expect(page.locator('.planner-background')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: '수학 공부 상세 보기', exact: true }).click();
  if (await page.getByRole('button', { name: '계획 편집', exact: true }).isVisible())
    await page.getByRole('button', { name: '계획 편집', exact: true }).click();
  if (await page.locator('.task-extra-actions > summary').isVisible())
    await page.locator('.task-extra-actions > summary').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'paused');
  const paused = await draws(page);
  await page.waitForTimeout(200);
  expect(await draws(page)).toBe(paused);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.liquid-chrome')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'running');
});

test('hidden tabs stop GPU draws and live reduced-motion changes freeze the effect', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  await page.goto('/#planner');
  await expect.poll(() => draws(page)).toBeGreaterThan(2);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'paused');
  const paused = await draws(page);
  await page.waitForTimeout(200);
  expect(await draws(page)).toBe(paused);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => draws(page)).toBeGreaterThan(paused);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'static');
  await page.waitForTimeout(100);
  const frozen = await draws(page);
  await page.mouse.move(250, 180);
  await page.waitForTimeout(200);
  expect(await draws(page)).toBe(frozen);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => draws(page)).toBeGreaterThan(frozen);
});

for (const width of [1440, 320])
  test(`chrome preserves layout and readable day/night surfaces at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCloud(page);
    await observeDraws(page);
    await page.goto('/#planner');
    await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
    const card = page.locator('.tasks-card');
    const before = (await card.boundingBox())!;
    const count = await draws(page);
    await expect.poll(() => draws(page)).toBeGreaterThan(count + 2);
    const after = (await card.boundingBox())!;
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(after[key] - before[key])).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const resolution = await page
      .locator('.liquid-chrome canvas')
      .evaluate((c: HTMLCanvasElement) => c.width * c.height);
    expect(resolution).toBeLessThanOrEqual(2_405_000);
    await page.screenshot({ path: `.local/chrome-morning-${width}.png`, fullPage: true });
    await page.locator('.planner-moment').getByRole('switch').click();
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
    await page.screenshot({ path: `.local/chrome-night-${width}.png`, fullPage: true });
  });

test('unavailable WebGL retains a static fallback and working planner controls', async ({
  page,
}) => {
  await mockCloud(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      id: string,
      options?: unknown,
    ) {
      if (id === 'webgl2') return null;
      return getContext.call(this, id, options);
    } as typeof getContext;
  });
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'fallback');
  await expect(page.locator('.liquid-chrome canvas')).toBeHidden();
  await expect(page.locator('.planner-background')).toBeVisible();
  await page.locator('.planner-moment').getByRole('switch').click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page.getByRole('button', { name: '수학 공부 상세 보기', exact: true }).click();
  if (await page.getByRole('button', { name: '계획 편집', exact: true }).isVisible())
    await page.getByRole('button', { name: '계획 편집', exact: true }).click();
  if (await page.locator('.task-extra-actions > summary').isVisible())
    await page.locator('.task-extra-actions > summary').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('lost GPU contexts show the fallback and recover rendering when restored', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('.liquid-chrome canvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    window.restoreChrome = () => extension.restoreContext();
    extension.loseContext();
  });
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'fallback');
  const count = await draws(page);
  await page.evaluate(() => window.restoreChrome?.());
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await expect.poll(() => draws(page)).toBeGreaterThan(count + 1);
});

test('data saver renders a still chrome surface without a continuous GPU loop', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'connection', {
      value: Object.assign(new EventTarget(), { saveData: true }),
      configurable: true,
    }),
  );
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'static');
  await page.waitForTimeout(100);
  const count = await draws(page);
  await page.waitForTimeout(250);
  expect(await draws(page)).toBe(count);
});
