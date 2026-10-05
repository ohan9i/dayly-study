import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

async function create(page: Page, title: string, items: string[]) {
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill(title);
  for (let i = 0; i < items.length; i++) {
    if (i) await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
    await page.getByLabel(`세부 항목 ${i + 1}`, { exact: true }).fill(items[i]);
  }
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}
const parent = (page: Page, title = '수학 공부') =>
  page.getByRole('checkbox', { name: `${title} 완료`, exact: true });
const child = (page: Page, index: number, title = '수학 공부') =>
  page.getByRole('checkbox', { name: `${title} 세부 항목 ${index} 완료`, exact: true });
async function check(page: Page, index: number, title = '수학 공부') {
  const checkbox = child(page, index, title);
  await checkbox.click();
  await expect(checkbox).toBeEnabled();
}
const bar = (page: Page, title = '수학 공부') =>
  page.getByRole('progressbar', { name: `${title} 진행률`, exact: true });
const ring = (page: Page) => page.getByRole('progressbar', { name: '오늘 진행률', exact: true });

test('partial checks, parent completion and the weighted day ring update immediately and survive reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockCloud(page, { nativeDetails: false });
  await page.goto('/');
  await signIn(page);
  await create(page, '수학 공부', ['확률 문제 20문제', '오답 정리', '개념 복습', '연습문제']);
  await create(page, '책 읽기', []);
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '0');
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (route.request().method() === 'PATCH')
      await new Promise((resolve) => setTimeout(resolve, 700));
    await route.fallback();
  });
  await child(page, 1).click();
  // Assert while the server response is still pending: no manual refresh is involved.
  await expect(child(page, 1)).toBeDisabled();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '25');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '20');
  await expect(child(page, 1)).toBeEnabled();
  await expect(parent(page)).toHaveAttribute('aria-checked', 'false');
  await check(page, 2);
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '50');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '40');
  await page.reload();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '50');
  await expect(child(page, 1)).toHaveAttribute('aria-checked', 'true');
  await expect(child(page, 3)).toHaveAttribute('aria-checked', 'false');
  await parent(page).click();
  await expect(parent(page)).toBeEnabled();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '100');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '80');
  for (let i = 1; i <= 4; i++) await expect(child(page, i)).toHaveAttribute('aria-checked', 'true');
  await check(page, 4);
  await expect(parent(page)).toHaveAttribute('aria-checked', 'false');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '75');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '60');
  await check(page, 4);
  await expect(parent(page)).toHaveAttribute('aria-checked', 'true');
  await parent(page).click();
  await expect(parent(page)).toBeEnabled();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
  await parent(page, '책 읽기').click();
  await expect(parent(page, '책 읽기')).toBeEnabled();
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '20');

  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: '세부 항목 1 완료', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: '세부 항목 1 완료', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('progressbar', { name: '세부 항목 진행률', exact: true }),
  ).toHaveAttribute('aria-valuenow', '25');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '25');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '40');
  await expect(page.locator('.progress-copy')).toContainText('2 / 5 완료');
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.locator('.stat-tile').first()).toContainText('2 / 5개');
  expect(errors).toEqual([]);
});

test('duplicate texts have independent checks and edit/remove keeps completion with the retained item', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await create(page, '복습', ['같은 내용', '같은 내용']);
  await check(page, 2, '복습');
  await expect(child(page, 1, '복습')).toHaveAttribute('aria-checked', 'false');
  await expect(bar(page, '복습')).toHaveAttribute('aria-valuenow', '50');
  await page.getByRole('button', { name: '복습 상세 보기' }).click();
  await page.getByRole('button', { name: '세부 항목 1 삭제', exact: true }).click();
  await page.getByLabel('세부 항목 1', { exact: true }).fill('내용을 수정해도 완료 유지');
  await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
  await page.getByLabel('세부 항목 2', { exact: true }).fill('새 항목');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(child(page, 1, '복습')).toHaveAttribute('aria-checked', 'true');
  await expect(child(page, 2, '복습')).toHaveAttribute('aria-checked', 'false');
  await check(page, 2, '복습');
  await expect(parent(page, '복습')).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '복습 상세 보기' }).click();
  await page.getByRole('button', { name: '세부 항목 2 삭제', exact: true }).click();
  await page.getByRole('button', { name: '세부 항목 1 삭제', exact: true }).click();
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(parent(page, '복습')).toHaveAttribute('aria-checked', 'true');
  await parent(page, '복습').click();
  await expect(parent(page, '복습')).toBeEnabled();
  await page.reload();
  await expect(parent(page, '복습')).toHaveAttribute('aria-checked', 'false');
});

test('failed progress saves roll back the optimistic checkbox and all aggregate progress', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await create(page, '수학 공부', ['확률', '오답']);
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, 600));
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: '체크 저장 권한을 확인해 주세요.' }),
    });
  });
  await child(page, 1).click();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '50');
  await expect(page.getByRole('status')).toContainText('체크 저장 권한');
  await expect(bar(page)).toHaveAttribute('aria-valuenow', '0');
  await expect(ring(page)).toHaveAttribute('aria-valuenow', '0');
  await expect(child(page, 1)).toHaveAttribute('aria-checked', 'false');
  await expect(parent(page)).toHaveAttribute('aria-checked', 'false');
});

for (const width of [1440, 1280, 800, 390, 360]) {
  test(`the existing layout stays intact with small progress controls at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width >= 800 ? 900 : 844 });
    await mockCloud(page);
    await page.goto('/');
    await signIn(page);
    await create(page, '수학 공부', [
      '확률 문제를 풀이하고 오답노트에 풀이 과정을 정리하기',
      '오답 정리',
      '개념 복습',
    ]);
    await check(page, 1);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(await bar(page).evaluate((el) => el.getBoundingClientRect().height)).toBe(4);
    expect(await ring(page).evaluate((el) => el.getBoundingClientRect().width)).toBe(44);
    mkdirSync('.local', { recursive: true });
    await page.screenshot({
      path: `.local/progress-${width}-home.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const fields = await page
      .locator('.detail-input-row')
      .first()
      .evaluate((row) => {
        const input = row.querySelector('input[type="text"]')!.getBoundingClientRect();
        const check = row.querySelector('.detail-checkbox')!.getBoundingClientRect();
        const remove = row.querySelector('.detail-remove-button')!.getBoundingClientRect();
        return {
          leftGap: input.left - check.right,
          rightGap: remove.left - input.right,
          inputWidth: input.width,
        };
      });
    expect(fields.leftGap).toBeGreaterThanOrEqual(3);
    expect(fields.rightGap).toBeGreaterThanOrEqual(3);
    expect(fields.inputWidth).toBeGreaterThan(155);
    await page.screenshot({ path: `.local/progress-${width}-editor.png`, animations: 'disabled' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(
      await page
        .locator('.detail-progress-track i')
        .last()
        .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration)),
    ).toBeLessThanOrEqual(0.01);
  });
}
