import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

async function scrollToProgress(page: Page, progress: number) {
  await page.locator('.welcome-runway').evaluate((el, p) => {
    const stage = el.querySelector<HTMLElement>('.welcome-stage')!;
    window.scrollTo(
      0,
      el.getBoundingClientRect().top + scrollY + (el.clientHeight - stage.clientHeight) * p,
    );
  }, progress);
  // Wait for the event-driven frame, not an arbitrary animation duration.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('native scroll opens and reverses the cover, hands off once and preserves the app DOM', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: '플래너 바로 열기' })).toBeVisible();
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: '내 계정', exact: true })).toHaveCount(0);
  await page
    .locator('.app-shell')
    .evaluate((el) => el.setAttribute('data-mount-proof', 'original'));
  mkdirSync('.local/welcome', { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/welcome/desktop-closed.png' });
  await scrollToProgress(page, 0.45);
  await expect(page.getByRole('link', { name: '플래너로 건너뛰기' })).toBeVisible();
  const opened = await page.locator('.book-front').getAttribute('style');
  await page.screenshot({ path: '.local/welcome/desktop-opening.png' });
  await scrollToProgress(page, 0.2);
  expect(await page.locator('.book-front').getAttribute('style')).not.toBe(opened);
  await scrollToProgress(page, 0.45);
  expect(await page.locator('.book-front').getAttribute('style')).toBe(opened);
  await scrollToProgress(page, 0.94);
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
  const alignment = await page.evaluate(() => {
    const paper = document.querySelector('.book-paper')!.getBoundingClientRect();
    const card = document.querySelector('.tasks-card')!.getBoundingClientRect();
    return Math.max(
      Math.abs(paper.x - card.x),
      Math.abs(paper.y - card.y),
      Math.abs(paper.width - card.width),
      Math.abs(paper.height - card.height),
    );
  });
  expect(alignment).toBeLessThan(10);
  await page.screenshot({ path: '.local/welcome/desktop-handoff.png' });
  await scrollToProgress(page, 1);
  await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
  await expect(page.getByRole('heading', { name: '오늘의 계획', exact: true })).toBeVisible();
  await page.screenshot({ path: '.local/welcome/desktop-planner.png' });
  await scrollToProgress(page, 0);
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await expect(page.getByRole('heading', { name: '오늘의 계획', exact: true })).toBeFocused();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mount-proof', 'original');
  await expect(page.locator('.moment, .study-scene')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('first keyboard target skips immediately and moves focus to the planner', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '플래너로 건너뛰기' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('h1')).toBeFocused();
  await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-entered', 'true');
});

test('reload and back restore the screen, date and position; a new base entry shows the cover', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await page.getByLabel('조회 날짜').fill('2026-09-15');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.view-calendar')).toBeVisible();
  const scroll = await page.evaluate(() => scrollY);
  await page.reload();
  await expect(page.locator('.view-calendar')).toBeVisible();
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-entered', 'true');
  expect(Math.abs((await page.evaluate(() => scrollY)) - scroll)).toBeLessThan(4);
  await page.goto('/?reference=return-test');
  await page.goBack();
  await expect(page.locator('.view-calendar')).toBeVisible();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.getByLabel('조회 날짜')).toHaveValue('2026-09-15');
  await page.goto('/?reference=new-entry');
  await page.goto('/');
  await expect(page.getByRole('link', { name: '플래너 바로 열기' })).toBeVisible();
});

test('a signed-in draft and theme survive leaving and returning through the scene', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('스크롤 후에도 유지되는 구조역학');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('부정정 보의 처짐 계산');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await page.getByRole('button', { name: '밤 공부로 전환' }).click();
  await page.getByRole('button', { name: '부정정 보의 처짐 계산 기록 열기' }).click();
  await page.locator('.detail-record-form textarea').fill('작성 중인 풀이 과정');
  await scrollToProgress(page, 0);
  await page.screenshot({ path: '.local/welcome/night-cover.png' });
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await expect(page.locator('.detail-record-form textarea')).toHaveValue('작성 중인 풀이 과정');
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await expect(
    page.getByRole('button', { name: '스크롤 후에도 유지되는 구조역학 상세 보기' }),
  ).toBeVisible();
});

test('reduced motion uses a static cover and normal flow, including live preference changes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockCloud(page);
  await page.goto('/');
  expect(await page.locator('.welcome-stage').evaluate((el) => getComputedStyle(el).position)).toBe(
    'relative',
  );
  await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await expect(page.locator('h1')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await scrollToProgress(page, 0);
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await expect(page.locator('h1')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await scrollToProgress(page, 0);
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
});

for (const width of [320, 390]) {
  test(`small screens, fast scroll and resize remain usable at ${width}px without WebGL`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: Parameters<typeof original>
      ) {
        if (String(args[0]).includes('webgl')) return null;
        return original.apply(this, args);
      } as typeof original;
    });
    await mockCloud(page);
    await page.goto('/');
    mkdirSync('.local/welcome', { recursive: true });
    await page.screenshot({ path: `.local/welcome/mobile-${width}-closed.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await scrollToProgress(page, 0.5);
    await page.setViewportSize({ width, height: 620 });
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.locator('.view-settings')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await scrollToProgress(page, 0);
    await page.getByRole('link', { name: '플래너 바로 열기' }).click();
    await expect(page.locator('h1')).toBeFocused();
  });
}

test('history storage failure leaves the entry and direct destination accessible', async ({
  page,
}) => {
  await page.addInitScript(() => {
    history.replaceState = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('link', { name: '플래너 바로 열기' }).click();
  await expect(page.locator('h1')).toBeFocused();
  await page.goto('/#planner');
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-entered', 'true');
  await expect(page.getByRole('button', { name: '내 계정', exact: true })).toBeVisible();
});
