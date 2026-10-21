import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';
test('plan menus support keyboard, Escape and outside clicks without moving record content', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('작업 메뉴');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const trigger = page.getByLabel('작업 메뉴 추가 작업', { exact: true });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: '계획 상세', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('button', { name: '복제', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(page.locator('.plan-actions[open]')).toHaveCount(0);
  await trigger.click();
  await page.locator('.page-heading h1').click();
  await expect(page.locator('.plan-actions[open]')).toHaveCount(0);
  await expect(page.locator('.swipe-row')).toHaveCount(0);
});
test('visitors read actual content with no disabled input form and get an inline login path', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await expect(page.locator('.task-read-view h3')).toHaveText('수학 공부');
  await expect(page.locator('input[name=title]')).toHaveCount(0);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.locator('.detail-record-toggle').first().click();
  await expect(page.locator('.record-login')).toContainText('로그인하면');
  await page.locator('.record-login').getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByLabel('이메일', { exact: true })).toBeVisible();
});
