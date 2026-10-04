import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

test('daily task and study log persist; search, calendar and statistics show actual records', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('오늘도 좋은 하루');
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: '.local/preview-desktop.png', fullPage: true });
  const date = await page.getByLabel('조회 날짜').inputValue();
  await page.getByRole('button', { name: '비우고 시작' }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('철근콘크리트 보의 휨 설계');
  await page.getByLabel('예정 시간').fill('14:30');
  await page.getByLabel('메모', { exact: true }).fill('설계 예제 1번 풀기');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await expect(
    page.getByRole('button', { name: '철근콘크리트 보의 휨 설계 상세 보기' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }).click();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '기록하기' }).click();
  await page.getByLabel('오늘 공부한 것').fill('단근 직사각형 보 이해');
  await page.getByLabel('공부 시간 (분)').fill('45');
  await page
    .getByLabel('배운 내용과 다음 공부')
    .fill('압축응력블록을 이해했다. 다음에는 철근비를 계산한다.');
  await page.getByRole('button', { name: '기록 저장' }).click();
  await page.reload();
  await expect(page.getByText('단근 직사각형 보 이해', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '기록 검색', exact: true }).click();
  await page.getByLabel('기록 검색어').fill('압축응력');
  await expect(
    page.getByRole('dialog').getByText('단근 직사각형 보 이해', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.locator('.stat-tile').nth(1)).toContainText('45');
  await expect(page.locator('.stat-tile').first()).toContainText('1 / 1개');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-day').filter({ hasText: '1/1 완료' })).toBeVisible();
  await page.locator('.calendar-day').filter({ hasText: '1/1 완료' }).click();
  await expect(page.getByLabel('조회 날짜')).toHaveValue(date);
  await expect(
    page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '철근콘크리트 보의 휨 설계 상세 보기' }).click();
  await page.getByLabel('할 일', { exact: true }).fill('철근콘크리트 복습');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await expect(page.getByRole('button', { name: '철근콘크리트 복습 상세 보기' })).toBeVisible();
  expect(errors).toEqual([]);
});
test('backup export and import preserve records; deletion requires explicit confirmation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 내려받기' }).click();
  const download = await downloadEvent;
  const path = await download.path();
  expect(download.suggestedFilename()).toMatch(/^dayly-\d{4}-\d{2}-\d{2}\.json$/);
  await page.getByRole('button', { name: '개인 기록 비우기' }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '개인 기록 비우기' }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.getByText('여백이 있는 하루', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('백업 파일 선택').setInputFiles(path!);
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(7);
});
test('mobile layout has no horizontal overflow and navigation and dialogs remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/preview-mobile.png', fullPage: true });
  for (const label of ['나의 하루', '달력', '공부 기록', '학습 흐름', '설정']) {
    await page.getByRole('button', { name: label, exact: true }).click();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('지금은 개인 모드로 시작해요');
  await page.getByRole('button', { name: '나의 하루로 돌아가기' }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '할 일 저장' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
