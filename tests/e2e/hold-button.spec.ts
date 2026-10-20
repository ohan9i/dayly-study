import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

test('theme buttons require a full hold, release resets the fill, and the chosen theme persists', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockCloud(page);
  await page.goto('/#planner');
  const toggle = page.getByRole('button', { name: '밤 공부로 전환', exact: true });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await toggle.hover();
  await page.mouse.down();
  await expect(toggle).toHaveAttribute('data-phase', 'holding');
  expect(
    await toggle
      .locator('.hold-button__fill svg')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe('rgb(255, 255, 255)');
  await expect
    .poll(() => toggle.evaluate((el) => Number(el.style.getPropertyValue('--hb-p'))))
    .toBeGreaterThan(0.15);
  mkdirSync('.local/hold', { recursive: true });
  await page.screenshot({ path: '.local/hold/desktop-holding.png' });
  await page.mouse.up();
  await expect(toggle).toHaveAttribute('data-phase', 'idle');
  await expect
    .poll(() => toggle.evaluate((el) => Number(el.style.getPropertyValue('--hb-p'))))
    .toBe(0);
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await toggle.click({ delay: 2150 });
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await expect(
    page.locator('.planner-moment .atmosphere-option[aria-pressed="true"]'),
  ).toHaveAttribute('aria-label', '밤 공부');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page
    .locator('.planner-moment')
    .getByRole('button', { name: '아침 창가', exact: true })
    .click({ delay: 2150 });
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  expect(errors).toEqual([]);
});

test('trash holds open the existing confirmation once and cancellation preserves the plan', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('길게 누르기 검증 계획');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  const task = page.getByRole('button', { name: '길게 누르기 검증 계획 상세 보기', exact: true });
  await task.click();
  const trash = page.getByRole('button', { name: '이 할 일 삭제', exact: true });
  await trash.click();
  await expect(page.getByRole('dialog')).not.toContainText('휴지통으로 보낼까요?');
  await trash.hover();
  await page.mouse.down();
  const box = (await trash.boundingBox())!;
  await page.mouse.move(box.x + box.width + 30, box.y);
  await expect(trash).toHaveAttribute('data-phase', 'idle');
  await page.mouse.up();
  await trash.click({ delay: 2150 });
  await expect(page.getByRole('dialog')).toContainText('휴지통으로 보낼까요?');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(task).toBeVisible();
  expect(cloud.tasks().some((x) => x.title === '길게 누르기 검증 계획')).toBe(true);
  await task.click();
  await trash.click({ delay: 2150 });
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(task).toHaveCount(0);
  expect(cloud.requests.some((r) => r.method === 'DELETE')).toBe(false);
});

test('keyboard short presses cancel, a full hold works, and virtual activation remains available', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  const toggle = page.getByRole('button', { name: '밤 공부로 전환', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await page.keyboard.down(' ');
  await expect(toggle).toHaveAttribute('data-phase', 'holding');
  await page.keyboard.press('Escape');
  await page.keyboard.up(' ');
  await expect(toggle).toHaveAttribute('data-phase', 'idle');
  await page.keyboard.down('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page.keyboard.up('Enter');
  await page
    .getByRole('button', { name: '아침 창가로 전환', exact: true })
    .evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
});

test('touch cancellation, cross-tab changes and reduced motion do not fire stale holds at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await mockCloud(page);
  await page.goto('/#planner');
  const toggle = page.getByRole('button', { name: '밤 공부로 전환', exact: true });
  const pointer = { button: 0, isPrimary: true, pointerId: 7, pointerType: 'touch' };
  await toggle.dispatchEvent('pointerdown', pointer);
  await expect(toggle).toHaveAttribute('data-phase', 'holding');
  await toggle.dispatchEvent('pointercancel', pointer);
  await expect(toggle).toHaveAttribute('data-phase', 'idle');
  await toggle.hover();
  await page.mouse.down();
  await page.evaluate(() => {
    localStorage.setItem('dayly.atmosphere', 'night');
    dispatchEvent(new StorageEvent('storage', { key: 'dayly.atmosphere', newValue: 'night' }));
  });
  await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page.waitForTimeout(2200); // A cancelled hold must not fire its old completion timer.
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const back = page.getByRole('button', { name: '아침 창가로 전환', exact: true });
  await back.click();
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
  await back.click({ delay: 2150 });
  await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'morning');
  await expect(page.locator('.hold-button[data-phase="holding"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('.local/hold', { recursive: true });
  await page.screenshot({ path: '.local/hold/mobile-idle.png' });
});
