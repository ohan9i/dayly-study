import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

test('the actual plan crumples on date and menu changes; checked tasks and an unsaved record survive', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('구김 효과 검증 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('구조역학 풀이');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  const checkbox = page.getByRole('checkbox').first();
  await checkbox.click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await page
    .getByRole('button', { name: /기록 열기/ })
    .first()
    .click();
  const input = page.locator('.detail-record-form textarea').first();
  await input.fill('메뉴를 다녀와도 남아 있어야 하는 구조역학 풀이');
  await page.evaluate(() => document.fonts.ready);
  // Wait for the lazy chunk to be warm, without depending on a fixed sleep.
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance.getEntriesByType('resource').some((r) => /PaperTransition.*\.js/.test(r.name)),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveAttribute(
    'data-phase',
    'crumpling',
  );
  await expect(page.locator('.paper-crumple')).toHaveAttribute('data-status', 'ready');
  const src = await page.locator('.paper-crumple').evaluate((el) => {
    const canvas = el.querySelector('canvas')!;
    return { width: canvas.width, height: canvas.height };
  });
  expect(src.width).toBeGreaterThan(200);
  expect(src.height).toBeGreaterThan(100);
  mkdirSync('.local/paper', { recursive: true });
  await page.screenshot({ path: '.local/paper/desktop-crumpling.png' });
  await expect(page.locator('.calendar-card')).toBeVisible();
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(input).toHaveValue('메뉴를 다녀와도 남아 있어야 하는 구조역학 풀이');
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  const date = await page.getByLabel('조회 날짜').inputValue();
  await page.getByRole('button', { name: '다음 날짜', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveAttribute(
    'data-phase',
    'crumpling',
  );
  await expect(page.getByLabel('조회 날짜')).not.toHaveValue(date);
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.getByRole('button', { name: '이전 날짜', exact: true }).click();
  await expect(checkbox).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rapid navigation, unavailable WebGL, and a failed capture still reach the chosen screen', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: unknown[]
    ) {
      if (kind.includes('webgl')) return null;
      return original.apply(this, [kind, ...args] as never);
    } as typeof original;
  });
  await mockCloud(page);
  await page.goto('/#planner');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-card')).toBeVisible();
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.nav-button[aria-label="달력"]')!.click();
    document.querySelector<HTMLButtonElement>('.nav-button[aria-label="설정"]')!.click();
  });
  await expect(page.locator('.main-content')).toHaveClass(/view-settings/);
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = () => {
      throw new Error('capture unavailable');
    };
  });
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.locator('.main-content')).toHaveClass(/view-stats/);
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
});

test('reduced motion, keyboard navigation and same-page clicks skip the 3D effect', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-card')).toBeVisible();
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '달력', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.calendar-card')).toBeVisible();
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
});

test('320px mobile uses a clipped visible sheet without covering navigation or causing overflow', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const result = original.apply(this, args);
      (window as unknown as { paperImage: string }).paperImage = result;
      return result;
    };
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await mockCloud(page);
  await page.goto('/#planner');
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance.getEntriesByType('resource').some((r) => /PaperTransition.*\.js/.test(r.name)),
      ),
    )
    .toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/paper/mobile-before.png' });
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveAttribute(
    'data-phase',
    'crumpling',
  );
  mkdirSync('.local/paper', { recursive: true });
  await page.screenshot({ path: '.local/paper/mobile-crumpling.png' });
  const image = await page.evaluate(() => (window as unknown as { paperImage: string }).paperImage);
  writeFileSync('.local/paper/mobile-texture.png', Buffer.from(image.split(',')[1], 'base64'));
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.main-content')).toHaveClass(/view-settings/);
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 650));
  await expect
    .poll(() => page.locator('.tasks-card').evaluate((el) => el.getBoundingClientRect().top))
    .toBeLessThan(0);
  const scrolledImage = await page.evaluate(async () => {
    const resource = performance
      .getEntriesByType('resource')
      .find((r) => /PaperTransition.*\.js/.test(r.name))!;
    const { capturePaper } = await import(/* @vite-ignore */ resource.name);
    const frame = await capturePaper(document.querySelector('.tasks-card'));
    return frame.src as string;
  });
  writeFileSync(
    '.local/paper/mobile-scrolled-texture.png',
    Buffer.from(scrolledImage.split(',')[1], 'base64'),
  );
  await page.screenshot({ path: '.local/paper/mobile-scrolled-source.png' });
});

test('in-flight effects stop on reduced motion and stop drawing after navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    (window as unknown as { paperDraws: number }).paperDraws = 0;
    WebGL2RenderingContext.prototype.drawArrays = function (...args) {
      (window as unknown as { paperDraws: number }).paperDraws++;
      return draw.apply(this, args);
    };
  });
  await mockCloud(page);
  await page.goto('/#planner');
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance.getEntriesByType('resource').some((r) => /PaperTransition.*\.js/.test(r.name)),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveAttribute(
    'data-phase',
    'crumpling',
  );
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  const draws = await page.evaluate(() => (window as unknown as { paperDraws: number }).paperDraws);
  expect(draws).toBeGreaterThan(0);
  await page.waitForTimeout(180); // Observe idle GPU work after the effect has been disposed.
  expect(await page.evaluate(() => (window as unknown as { paperDraws: number }).paperDraws)).toBe(
    draws,
  );
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.getByRole('button', { name: '다음 날짜', exact: true }).click();
  await expect(page.locator('.planner-paper-transition')).toHaveAttribute(
    'data-phase',
    'crumpling',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.planner-paper-transition')).toHaveCount(0);
  await expect(page.locator('.main-content')).toHaveClass(/view-home/);
});
