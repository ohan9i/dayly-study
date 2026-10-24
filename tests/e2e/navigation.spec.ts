import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';

const query = (page: import('@playwright/test').Page) => new URL(page.url()).search;

test('screens and dates live in the address, and back returns to the previous one', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await expect(query(page)).toBe('');

  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.getByRole('heading', { name: '달력', level: 1 })).toBeVisible();
  expect(query(page)).toContain('view=calendar');

  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.getByRole('heading', { name: '학습 흐름', level: 1 })).toBeVisible();
  expect(query(page)).toContain('view=stats');

  await page.goBack();
  await expect(page.getByRole('heading', { name: '달력', level: 1 })).toBeVisible();
  expect(query(page)).toContain('view=calendar');

  await page.goBack();
  await expect(page.getByRole('heading', { name: '오늘의 계획', level: 1 })).toBeVisible();
  expect(query(page)).toBe('');

  await page.goForward();
  await expect(page.getByRole('heading', { name: '달력', level: 1 })).toBeVisible();
});

test('a dated link opens that day straight away and leaves today out of the address', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/?view=home&date=2026-10-20');
  // A destination in the address skips the decorative opening.
  await expect(page.locator('.welcome-runway')).toBeHidden();
  await expect(page.getByLabel('조회 날짜')).toHaveValue('2026-10-20');

  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '오늘의 계획', level: 1 })).toBeVisible();
  expect(query(page)).not.toContain('date=');

  await page.goBack();
  await expect(page.getByLabel('조회 날짜')).toHaveValue('2026-10-20');
});

test('everyday keys open search, start a plan and step through days', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);

  await page.keyboard.press('Slash');
  await expect(page.getByRole('dialog')).toContainText('나의 할 일 찾기');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.keyboard.press('n');
  await expect(page.getByRole('dialog')).toContainText('계획 추가');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  const today = await page.getByLabel('조회 날짜').inputValue();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('조회 날짜')).not.toHaveValue(today);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('조회 날짜')).toHaveValue(today);
});

test('typing a letter into a field never triggers a shortcut', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  const title = page.getByLabel('할 일', { exact: true });
  await title.fill('');
  await title.pressSequentially('n/n');
  await expect(title).toHaveValue('n/n');
  await expect(page.getByRole('dialog')).toContainText('계획 추가');
});
