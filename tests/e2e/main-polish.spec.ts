import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';

test('plan history is fetched only when opened and closes back to settings', async ({ page }) => {
  const cloud = await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('변경 이력 확인 계획');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.retention-status')).toContainText('복구 보호 적용됨');
  expect(cloud.requests.filter((r) => r.path === '/rest/v1/task_change_history')).toHaveLength(0);
  await expect(page.locator('.change-list')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '공부 공간의 분위기', exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator('.topbar').getByRole('switch')).toHaveCount(0);
  await expect(
    page.locator('.protection-section > h3').filter({ hasText: '계획 변경 이력' }),
  ).toBeVisible();
  const open = page.getByRole('button', { name: '계획 변경 이력 보기', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '계획 변경 이력', exact: true })).toBeVisible();
  await expect(dialog.locator('.change-list')).toContainText('변경 이력 확인 계획');
  expect(cloud.requests.some((r) => r.path === '/rest/v1/task_change_history')).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(open).toBeFocused();
  await expect(page.locator('.change-list')).toHaveCount(0);
  await page.route('https://*.supabase.co/rest/v1/task_change_history*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501' }),
    }),
  );
  await open.click();
  await expect(dialog.getByRole('alert')).toContainText('변경 이력을 불러오지 못했어요');
  await page.unroute('https://*.supabase.co/rest/v1/task_change_history*');
  await dialog.getByRole('button', { name: '이력 새로고침', exact: true }).click();
  await expect(dialog.locator('.change-list')).toContainText('변경 이력 확인 계획');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

for (const width of [1440, 390, 320])
  test(`main text remains readable and ordered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCloud(page);
    await page.goto('/#planner');
    await expect(page.getByRole('switch')).toHaveCount(1);
    const sizes = await page.locator('.home-layout').evaluate((root) => {
      const size = (selector: string) =>
        parseFloat(getComputedStyle(root.querySelector(selector)!).fontSize);
      return {
        heading: size('h1'),
        section: size('.card-header h2'),
        task: size('.task-title'),
        label: size('.task-title .spring-check__label'),
        detail: size('.detail-row-title'),
        meta: size('.save-note, .editing-notice'),
      };
    });
    expect(sizes.heading).toBeGreaterThan(sizes.section);
    expect(sizes.section).toBeGreaterThan(sizes.task);
    expect(sizes.task).toBeGreaterThan(sizes.detail);
    expect(sizes.task).toBe(sizes.label);
    expect(sizes.detail).toBeGreaterThanOrEqual(14);
    expect(sizes.meta).toBeGreaterThanOrEqual(12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/main-polish-${width}.png`, fullPage: true });
  });
