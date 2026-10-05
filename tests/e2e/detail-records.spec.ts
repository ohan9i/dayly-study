import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn, PNG } from './cloud-fixture';

test('detail records stay inline, independent, and separate from progress', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가' }).click();
  await page.getByLabel('할 일', { exact: true }).fill('수학 공부');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('확률 문제 풀기');
  await page.getByRole('button', { name: '한 줄 추가' }).click();
  await page.getByLabel('세부 항목 2', { exact: true }).fill('오답 정리');
  await page.getByRole('button', { name: '할 일 저장' }).click();

  await page.getByRole('button', { name: '확률 문제 풀기 기록 열기' }).click();
  await page.getByLabel('수학 공부 확률 문제 풀기 수행 내용').fill('1번부터 20번까지 풀었어요.');
  await page.getByRole('button', { name: '오답 정리 기록 열기' }).click();
  await expect(page.getByLabel('수학 공부 확률 문제 풀기 수행 내용')).toHaveValue(
    '1번부터 20번까지 풀었어요.',
  );
  await page.getByLabel('수학 공부 오답 정리 수행 내용').fill('7번을 다시 풀었어요.');
  await page.locator('.task-details > li').nth(1).getByLabel('수행 파일 첨부').setInputFiles({
    name: '오답.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await page.locator('.task-details li').first().getByRole('button', { name: '기록 저장' }).click();
  await expect(page.locator('.task-details li').first()).toContainText(
    '1번부터 20번까지 풀었어요.',
  );
  await expect(page.getByRole('progressbar', { name: '수학 공부 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await page.locator('.task-details li').nth(1).getByRole('button', { name: '기록 저장' }).click();
  await expect(page.locator('.task-details > li').nth(1).locator('.attachment-card')).toContainText(
    '오답.png',
  );
  await expect(page.locator('.task-details > li').nth(1).getByRole('status')).toContainText(
    '기록을 저장했어요.',
  );
  mkdirSync('.local', { recursive: true });
  await page.screenshot({
    path: '.local/detail-records-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  for (const width of [800, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: `.local/detail-records-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await expect(
    page.getByRole('button', { name: '확률 문제 풀기 기록 접기' }).locator('.record-dot'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '확률 문제 풀기 기록 열기' }).click();
  await expect(page.locator('.task-details li').first()).toContainText(
    '1번부터 20번까지 풀었어요.',
  );
  await page.getByRole('checkbox', { name: '수학 공부 세부 항목 1 완료' }).click();
  await expect(page.getByRole('progressbar', { name: '수학 공부 진행률' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await expect(page.locator('.progress-copy')).toContainText('1 / 2 완료');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(
    page.locator(
      '.calendar-day[aria-label*="세부 항목 2개 중 1개 완료"] .calendar-progress-track i',
    ),
  ).toHaveAttribute('style', 'width: 50%;');
  await page.screenshot({
    path: '.local/detail-calendar-390.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: '수학 공부 학습 흐름' })).toHaveAttribute(
    'aria-valuenow',
    '50',
  );
  await page.screenshot({
    path: '.local/detail-flow-390.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await page.getByRole('button', { name: '세부 항목 2 삭제' }).click();
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await expect(page.getByRole('dialog')).toContainText('7번을 다시 풀었어요.');
  await expect(page.getByRole('dialog')).toContainText('오답.png');
});
