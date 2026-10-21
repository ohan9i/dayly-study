import { expect, test, type Page } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

declare global {
  interface Window {
    chromeDraws: number;
    chromeRectReads: number;
    chromeInteraction: {
      simulationSteps: number;
      trails: number;
      clicks: number;
      shiftX: number;
    };
    restoreChrome?: () => void;
  }
}

async function observeDraws(page: Page) {
  await page.addInitScript(() => {
    window.chromeRectReads = 0;
    const getRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('liquid-chrome')) window.chromeRectReads++;
      return getRect.call(this);
    };
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

test('high-frequency pointer bursts keep the latest position without per-event layout reads', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  await observeInteraction(page);
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await page.mouse.move(150, 150);
  await expect.poll(() => page.evaluate(() => window.chromeInteraction.shiftX)).toBeLessThan(-0.04);
  const trails = await page.evaluate(() => window.chromeInteraction.trails);
  const reads = await page.evaluate(() => {
    const before = window.chromeRectReads;
    for (let i = 0; i < 1000; i++) {
      window.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: 400 + i,
          clientY: 300,
          pointerType: 'mouse',
        }),
      );
    }
    return window.chromeRectReads - before;
  });
  expect(reads).toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.chromeInteraction.shiftX))
    .toBeGreaterThan(0.04);
  expect(await page.evaluate(() => window.chromeInteraction.trails)).toBe(trails + 1);
});

async function observeInteraction(page: Page) {
  await page.addInitScript(() => {
    window.chromeInteraction = { simulationSteps: 0, trails: 0, clicks: 0, shiftX: 0 };
    const names = new WeakMap<WebGLUniformLocation, string>();
    const prototype = WebGL2RenderingContext.prototype;
    const getLocation = prototype.getUniformLocation;
    prototype.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    const uniform2f = prototype.uniform2f;
    prototype.uniform2f = function (location, x, y) {
      if ((this.canvas as HTMLCanvasElement).classList.contains('liquid-chrome__canvas')) {
        const stats = window.chromeInteraction;
        const name = location && names.get(location);
        if (name === 'uShift') stats.shiftX = x;
        if (name === 'uImpulse') {
          stats.simulationSteps++;
          if (x < -0.5) stats.clicks++;
          else if (x < 0) stats.trails++;
        }
      }
      return uniform2f.call(this, location, x, y);
    };
  });
}

test('pointer movement and clicks drive ripples without idle fluid work or modal input', async ({
  page,
}) => {
  await mockCloud(page);
  await observeDraws(page);
  await observeInteraction(page);
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await expect.poll(() => draws(page)).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.chromeInteraction.simulationSteps)).toBe(0);

  await page.mouse.move(1300, 150);
  await page.mouse.move(1400, 300, { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.chromeInteraction.trails)).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => window.chromeInteraction.shiftX))
    .toBeGreaterThan(0.04);
  await page.mouse.click(1400, 500);
  await expect.poll(() => page.evaluate(() => window.chromeInteraction.clicks)).toBeGreaterThan(0);
  await page.mouse.move(150, 150, { steps: 10 });
  await expect.poll(() => page.evaluate(() => window.chromeInteraction.shiftX)).toBeLessThan(-0.04);

  await page.getByRole('button', { name: '수학 공부 상세 보기', exact: true }).click();
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-motion', 'paused');
  const paused = await draws(page);
  await page.mouse.move(1400, 600, { steps: 10 });
  await page.waitForTimeout(150);
  expect(await draws(page)).toBe(paused);
  await page.keyboard.press('Escape');
  await expect.poll(() => draws(page)).toBeGreaterThan(paused);
});

test('without float textures the surface follows the cursor and planner controls still work', async ({
  page,
}) => {
  await mockCloud(page);
  await observeInteraction(page);
  await page.addInitScript(() => {
    const getExtension = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function (name) {
      if (name === 'EXT_color_buffer_float') return null;
      return Reflect.apply(getExtension, this, [name]);
    };
  });
  await page.goto('/#planner');
  await expect(page.locator('.liquid-chrome')).toHaveAttribute('data-renderer', 'webgl');
  await page.mouse.move(1400, 300);
  await expect
    .poll(() => page.evaluate(() => window.chromeInteraction.shiftX))
    .toBeGreaterThan(0.04);
  await page.mouse.click(1400, 500);
  expect(await page.evaluate(() => window.chromeInteraction.simulationSteps)).toBe(0);
  await page.getByRole('button', { name: '수학 공부 상세 보기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

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
    expect(resolution).toBeLessThanOrEqual(502_000);
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
