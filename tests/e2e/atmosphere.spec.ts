import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { mockCloud, signIn, OWN_SPACE } from './cloud-fixture';
import { encodeTaskProgress, todayKey, type Task } from '../../src/domain';

async function setup(page: Page) {
  const task: Task = {
    id: '30000000-0000-0000-0000-000000000080',
    workspace_id: OWN_SPACE,
    created_by: '10000000-0000-0000-0000-000000000001',
    title: '건축구조 복습',
    date: todayKey(),
    details: ['철근콘크리트 보의 휨 설계'],
  };
  await mockCloud(page, { tasks: [{ ...task, details: encodeTaskProgress(task, new Set()) }] });
  await page.goto('/#planner');
  await signIn(page);
  await page.evaluate(() => document.fonts.ready);
}

async function contrast(page: Page, selectors: string[], filename: string) {
  const targets = await page.evaluate(
    (selectors) =>
      selectors.map((selector) => {
        const el = document.querySelector<HTMLElement>(selector)!;
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const word = el.querySelector<HTMLElement>('.spring-check__word');
        const rules = Array.from(el.querySelectorAll<HTMLElement>('.spring-check__rule'));
        const result = {
          selector,
          x: rect.x,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height,
          color: style.color,
          opacity: word ? Number(getComputedStyle(word).opacity) : 1,
          ruleVisibility: rules.map((rule) => rule.style.visibility),
          inline: el.style.cssText,
          minimum: parseFloat(style.fontSize) >= 24 ? 3 : 4.5,
        };
        el.style.color = 'transparent';
        el.style.textShadow = 'none';
        el.style.textDecorationColor = 'transparent';
        rules.forEach((rule) => {
          rule.style.visibility = 'hidden';
        });
        return result;
      }),
    selectors,
  );
  const pixels = await sharp(await page.screenshot({ fullPage: true, animations: 'disabled' }))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  await page.evaluate(
    (targets) =>
      targets.forEach((target) => {
        const el = document.querySelector<HTMLElement>(target.selector)!;
        el.style.cssText = target.inline;
        el.querySelectorAll<HTMLElement>('.spring-check__rule').forEach((rule, index) => {
          rule.style.visibility = target.ruleVisibility[index];
        });
      }),
    targets,
  );
  const luminance = (rgb: number[]) =>
    rgb
      .map((v) => v / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const values = targets.map((target) => {
    const ink = target.color.match(/\d+/g)!.slice(0, 3).map(Number);
    const samples: number[] = [];
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9])
      for (const y of [0.25, 0.5, 0.75]) {
        const offset =
          (Math.floor(target.y + target.height * y) * pixels.info.width +
            Math.floor(target.x + target.width * x)) *
          3;
        const backdrop = [...pixels.data.subarray(offset, offset + 3)];
        const bg = luminance(backdrop);
        const fg = luminance(
          ink.map(
            (value, channel) => value * target.opacity + backdrop[channel] * (1 - target.opacity),
          ),
        );
        samples.push((Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05));
      }
    return { selector: target.selector, contrast: Math.min(...samples), minimum: target.minimum };
  });
  writeFileSync(filename, JSON.stringify(values, null, 2));
  for (const result of values)
    expect(result.contrast, result.selector).toBeGreaterThanOrEqual(result.minimum);
}

test('theme persists, synchronizes across tabs and preserves a draft in an open dialog', async ({
  page,
  context,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '밤 공부로 전환', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  const date = await page.getByLabel('조회 날짜').inputValue();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await expect(page.getByLabel('조회 날짜')).toHaveValue(date);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('아직 저장하지 않은 구조역학 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('처짐 계산 복습');
  const other = await context.newPage();
  await mockCloud(other);
  await other.goto('/#planner');
  await other.getByRole('button', { name: '아침 창가로 전환', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue(
    '아직 저장하지 않은 구조역학 계획',
  );
  await expect(page.getByLabel('세부 항목 1', { exact: true })).toHaveValue('처짐 계산 복습');
  await other.close();
});

for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [320, 800],
]) {
  test(`night surfaces, contrast and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => localStorage.setItem('dayly.atmosphere', 'night'));
    await setup(page);
    const checked = page.getByRole('checkbox').first();
    await checked.click();
    await expect(checked).toBeEnabled();
    // Contrast samples must measure the reading surface, without the temporary login toast.
    await expect(page.locator('.toast.visible')).toHaveCount(0, { timeout: 6000 });
    mkdirSync('.local/atmosphere', { recursive: true });
    const capture = async (view: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.local/atmosphere/night-${width}-${view}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    };
    const buttons = await page.locator('.topbar button:visible').evaluateAll((buttons) =>
      buttons.map((button) => {
        const r = button.getBoundingClientRect();
        return { left: r.left, right: r.right, width: r.width, height: r.height };
      }),
    );
    for (let i = 0; i < buttons.length; i++) {
      expect(buttons[i].left).toBeGreaterThanOrEqual(0);
      expect(buttons[i].right).toBeLessThanOrEqual(width);
      expect(buttons[i].height).toBeGreaterThanOrEqual(36);
      if (i) expect(buttons[i].left).toBeGreaterThanOrEqual(buttons[i - 1].right);
    }
    await expect(page.locator('.study-scene, .moment blockquote')).toHaveCount(0);
    await expect(page.locator('.planner-moment .live-clock')).toBeVisible();
    await expect(page.locator('.planner-moment .atmosphere-picker')).toBeVisible();
    await capture('home');
    await contrast(
      page,
      ['.view-home h1', '.task-title', '.detail-row-title', '.save-note', '.live-clock'],
      `.local/atmosphere/night-${width}-contrast.json`,
    );
    for (const label of ['달력', '학습 흐름', '설정']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await capture(label);
    }
    await page
      .locator('.atmosphere-settings')
      .getByRole('button', { name: /아침 창가/ })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
    await page.getByRole('button', { name: '나의 하루', exact: true }).click();
    await page.screenshot({
      path: `.local/atmosphere/morning-${width}-home.png`,
      fullPage: true,
      animations: 'disabled',
    });
    if (width > 1000) {
      await contrast(
        page,
        ['.date-display', '.live-clock'],
        `.local/atmosphere/morning-${width}-controls-contrast.json`,
      );
    }
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await page
      .locator('.atmosphere-settings')
      .getByRole('button', { name: /밤 공부/ })
      .click();
    await page.getByRole('button', { name: '내 계정', exact: true }).click();
    await capture('account');
    await contrast(
      page,
      ['.modal h2', '.account-status p'],
      `.local/atmosphere/night-${width}-account-contrast.json`,
    );
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '할 일 검색', exact: true }).click();
    await page.getByLabel('할 일 검색어').fill('건축구조');
    await capture('search');
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.getByRole('button', { name: '나의 하루', exact: true }).click();
    await page.getByRole('button', { name: '건축구조 복습 상세 보기', exact: true }).click();
    await capture('detail');
    await contrast(
      page,
      ['.modal h2', 'input[name="title"]'],
      `.local/atmosphere/night-${width}-detail-contrast.json`,
    );
  });
}

test('reduced motion and keyboard changes are immediate; blocked storage still allows themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockCloud(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'dayly.atmosphere') throw new DOMException('Storage disabled', 'SecurityError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/#planner');
  await page.getByRole('button', { name: '밤 공부로 전환', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  expect(
    await page
      .locator('.scenery')
      .evaluate((el) => getComputedStyle(el, '::after').transitionDuration),
  ).toBe('0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: '아침 창가로 전환', exact: true }).focus();
  await page.keyboard.down('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await page.keyboard.up('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await expect(page.locator('html')).toHaveAttribute('data-interaction', 'keyboard');
  expect(
    await page
      .locator('.scenery')
      .evaluate((el) => getComputedStyle(el, '::after').transitionDuration),
  ).toBe('0s');
});
