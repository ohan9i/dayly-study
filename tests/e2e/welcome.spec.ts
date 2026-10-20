import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

test.beforeEach(() => mkdirSync('.local/welcome', { recursive: true }));

async function openPlanner(page: Page) {
  await page.mouse.wheel(0, 12);
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'entered');
  await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
}

test('one scroll starts an autonomous sequence; reverse scroll never brings the opening back', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DAYLY', exact: true })).toBeVisible();
  await expect(page.locator('.welcome-controls')).toHaveCount(0);
  await expect(page.getByText('스크롤해서 펼치기')).toHaveCount(0);
  await expect(page.getByText('플래너 바로 열기')).toHaveCount(0);
  await expect(page.locator('.planner-layer')).toHaveAttribute('inert', '');
  await page
    .locator('.app-shell')
    .evaluate((el) => el.setAttribute('data-mount-proof', 'original'));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/welcome/desktop-closed.png' });
  await page.mouse.wheel(0, 8);
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'opening');
  const animations = await page
    .locator('.welcome-wordmark')
    .evaluate((el) => el.getAnimations({ subtree: true }).length);
  expect(animations).toBe(5);
  // An unchanged scroll position must still advance the cover.
  const start = await page.locator('.book-front').evaluate((el) => getComputedStyle(el).transform);
  await expect
    .poll(() => page.locator('.book-front').evaluate((el) => getComputedStyle(el).transform))
    .not.toBe(start);
  await page.mouse.wheel(0, -100);
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'entered');
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await expect(page.locator('#planner')).toBeFocused();
  await page.screenshot({ path: '.local/welcome/desktop-planner.png' });
  for (const amount of [1000, -1000, -1000]) await page.mouse.wheel(0, amount);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-mount-proof', 'original');
  await expect(page.locator('.planner-moment .live-clock')).toBeVisible();
  await expect(page.locator('.moment blockquote')).toHaveCount(0);
  expect(await page.evaluate(() => history.state.daylyEntry.intro)).toBe(false);
  expect(errors).toEqual([]);
});

test('keyboard-only skip is the first target and scrolling keys enter immediately', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '플래너로 건너뛰기' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#planner')).toBeFocused();
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await page.goto('/?reference=keyboard');
  await page.goto('/');
  await page.keyboard.press('PageDown');
  await expect(page.locator('#planner')).toBeFocused();
  await expect(page.locator('.welcome-runway')).toBeHidden();
});

test('reload and back restore the app and selected date without an opening runway', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await openPlanner(page);
  await page.getByLabel('조회 날짜').fill('2026-09-15');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await page.reload();
  await expect(page.locator('.view-calendar')).toBeVisible();
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await page.goto('/?reference=return-test');
  await page.goBack();
  await expect(page.locator('.view-calendar')).toBeVisible();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.getByLabel('조회 날짜')).toHaveValue('2026-09-15');
  await page.goto('/?reference=new-entry');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'DAYLY', exact: true })).toBeVisible();
});

test('signed-in drafts, restored side clock and theme survive scrolling and menu changes', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await openPlanner(page);
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('스크롤 후에도 유지되는 구조역학');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('부정정 보의 처짐 계산');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await page
    .locator('.planner-moment')
    .getByRole('switch', { name: '밤 공부', exact: true })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page.getByRole('button', { name: '부정정 보의 처짐 계산 기록 열기' }).click();
  await page.locator('.detail-record-form textarea').fill('작성 중인 풀이 과정');
  await page.mouse.wheel(0, 600);
  await page.mouse.wheel(0, -1500);
  await expect(page.locator('.detail-record-form textarea')).toHaveValue('작성 중인 풀이 과정');
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  expect(
    await page.locator('.wide-page').evaluate((el) => getComputedStyle(el).animationName),
  ).toBe('page-enter');
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.locator('.planner-moment .atmosphere-picker')).toBeVisible();
  await expect(page.locator('blockquote')).toHaveCount(0);
});

test('reduced motion and preference changes enter without trapping the app', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockCloud(page);
  await page.goto('/');
  await page.mouse.wheel(0, 10);
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await expect(page.locator('#planner')).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await page.goto('/?reference=motion');
  await page.goto('/');
  await page.mouse.wheel(0, 10);
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'opening');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.welcome-runway')).toBeHidden();
});

for (const width of [320, 390]) {
  test(`touch entry and resize remain usable at ${width}px without WebGL`, async ({ page }) => {
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
    await page.screenshot({ path: `.local/welcome/mobile-${width}-closed.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => {
      window.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [new Touch({ identifier: 1, target: document.body, clientY: 500 })],
        }),
      );
      window.dispatchEvent(
        new TouchEvent('touchmove', {
          touches: [new Touch({ identifier: 1, target: document.body, clientY: 420 })],
        }),
      );
    });
    await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'opening');
    await page.setViewportSize({ width, height: 620 });
    await expect(page.locator('.welcome-runway')).toBeHidden();
    await expect(page.locator('.planner-layer')).not.toHaveAttribute('inert');
    await expect(page.locator('.planner-moment .atmosphere-picker')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: '설정', exact: true }).click();
    await expect(page.locator('.view-settings')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('.welcome-runway')).toBeHidden();
  });
}

test('failed history storage and missing animation APIs still permit immediate entry', async ({
  page,
}) => {
  await page.addInitScript(() => {
    history.replaceState = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
    Element.prototype.animate = undefined as unknown as typeof Element.prototype.animate;
  });
  await mockCloud(page);
  await page.goto('/');
  await page.mouse.wheel(0, 10);
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await expect(page.locator('#planner')).toBeFocused();
  await page.goto('/#planner');
  await expect(page.getByRole('button', { name: '내 계정', exact: true })).toBeVisible();
});

test('HoloCard draws the foil and stops rendering after the planner opens', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { holoDraws: number };
    state.holoDraws = 0;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...args: Parameters<typeof draw>) {
      state.holoDraws++;
      return draw.apply(this, args);
    };
  });
  await mockCloud(page);
  await page.goto('/');
  const canvas = page.locator('.planner-cover-holo canvas');
  const supported = await canvas.evaluate((el) =>
    Boolean((el as HTMLCanvasElement).getContext('webgl2')),
  );
  if (supported) {
    await expect(page.locator('.planner-cover-holo')).toHaveAttribute('data-ready', '');
    await page.locator('.planner-cover-holo').hover();
    await expect
      .poll(() => page.evaluate(() => (window as typeof window & { holoDraws: number }).holoDraws))
      .toBeGreaterThan(0);
  }
  await openPlanner(page);
  const before = await page.evaluate(
    () => (window as typeof window & { holoDraws: number }).holoDraws,
  );
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, -1000);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() => (window as typeof window & { holoDraws: number }).holoDraws),
  ).toBe(before);
  await expect(page.locator('.welcome-runway')).toBeHidden();
});
