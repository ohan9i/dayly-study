import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { mockCloud, signIn, TEST_EMAIL, TEST_PASSWORD } from './cloud-fixture';

test('detail items persist; search, calendar and statistics show main task completion', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('오늘도 좋은 하루');
  await expect(page.getByRole('button', { name: '공부 기록', exact: true })).toHaveCount(0);
  await expect(page.getByText('오늘의 공부 기록', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: '.local/preview-desktop.png', fullPage: true });
  const date = await page.getByLabel('조회 날짜').inputValue();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('철근콘크리트 보의 휨 설계');
  await expect(page.getByLabel('과목', { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="time"]')).toHaveCount(0);
  await expect(page.getByLabel('메모', { exact: true })).toHaveCount(0);
  await page.getByLabel('세부 항목 1', { exact: true }).fill('압축응력블록 설계 예제 1번 풀기');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await expect(
    page.getByRole('button', { name: '철근콘크리트 보의 휨 설계 상세 보기' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }).click();
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.task-details')).toContainText('압축응력블록 설계 예제 1번 풀기');
  await page.getByRole('button', { name: '할 일 검색', exact: true }).click();
  await page.getByLabel('할 일 검색어').fill('철근콘크리트');
  await expect(page.getByRole('dialog').locator('.search-results > button')).toHaveCount(1);
  await page.getByLabel('할 일 검색어').fill('압축응력');
  await expect(
    page.getByRole('dialog').getByText('철근콘크리트 보의 휨 설계', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.locator('.stat-tile').nth(1)).toContainText('100');
  await expect(page.locator('.stat-tile').first()).toContainText('1 / 1개');
  await expect(page.locator('.subject-stat')).toHaveCount(0);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-day').filter({ hasText: '1/1 완료' })).toBeVisible();
  await page.locator('.calendar-day').filter({ hasText: '1/1 완료' }).click();
  await expect(page.getByLabel('조회 날짜')).toHaveValue(date);
  await expect(
    page.getByRole('checkbox', { name: '철근콘크리트 보의 휨 설계 완료' }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '철근콘크리트 보의 휨 설계 상세 보기' }).click();
  await page.getByLabel('할 일', { exact: true }).fill('철근콘크리트 복습');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('건축시공학 복습');
  await page.getByRole('button', { name: '할 일 저장' }).click();
  await expect(page.getByRole('button', { name: '철근콘크리트 복습 상세 보기' })).toBeVisible();
  await expect(page.locator('.task-details')).toContainText('건축시공학 복습');
  expect(errors).toEqual([]);
});
test('login errors, signup and reset requests keep editing locked; logout locks again', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel('비밀번호', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '비밀번호로 로그인', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('이메일 또는 비밀번호');
  await page.getByRole('button', { name: '비밀번호를 잊었나요?' }).click();
  await page.getByRole('button', { name: '재설정 메일 받기' }).click();
  await expect(page.getByRole('dialog')).toContainText('가입한 계정이 있다면');
  await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
  await page.getByRole('button', { name: '회원가입', exact: true }).click();
  await page.getByLabel('비밀번호', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('different-password');
  await page.getByRole('button', { name: '계정 만들기', exact: true }).click();
  await expect(page.getByRole('alert').last()).toContainText('같지 않아요');
  expect(cloud.requests.filter((request) => request.path === '/auth/v1/signup')).toHaveLength(0);
  await page.getByLabel('비밀번호 확인', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '계정 만들기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('가입 확인 메일');
  await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
  await signIn(page);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(TEST_PASSWORD);
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('checkbox').first()).toBeDisabled();
  expect(
    cloud.requests.filter(
      (request) =>
        request.path.startsWith('/rest/') &&
        !request.path.includes('/rpc/ensure_personal_workspace') &&
        request.method !== 'GET',
    ),
  ).toHaveLength(0);
});
test('mobile layout has no horizontal overflow and navigation and dialogs remain usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockCloud(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/preview-mobile.png', fullPage: true });
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page
    .getByLabel('할 일', { exact: true })
    .fill('건축공학 설계와 구조계획 및 시공관리 내용을 정리하고 연습문제 복습하기');
  await page
    .getByLabel('세부 항목 1', { exact: true })
    .fill('건축공학및환경설계와시공관리'.repeat(2));
  await page.getByRole('button', { name: '할 일 저장' }).click();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of ['나의 하루', '달력', '학습 흐름', '설정']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `${label} at ${width}px`,
      ).toBe(true);
    }
  }
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 내려받기' }).click();
  const backup = JSON.parse(readFileSync((await (await downloadEvent).path())!, 'utf8'));
  expect(backup.tasks[0].details).toEqual(['건축공학및환경설계와시공관리'.repeat(2)]);
  expect(backup.tasks[0].subject).toBeUndefined();
  expect(backup.tasks[0].time).toBeUndefined();
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(TEST_EMAIL);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '할 일 저장' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('a password recovery link opens the new-password form and completes recovery', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/' + cloud.recoveryHash);
  await expect(page.getByLabel('새 비밀번호', { exact: true })).toBeVisible();
  await page.getByLabel('새 비밀번호', { exact: true }).fill('new-study-pass-2026');
  await page.getByLabel('비밀번호 확인', { exact: true }).fill('new-study-pass-2026');
  await page.getByRole('button', { name: '새 비밀번호 저장' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('여백이 있는 하루', { exact: true })).toBeVisible();
  expect(
    cloud.requests.some(
      (request) =>
        request.path === '/auth/v1/user' &&
        request.method === 'PUT' &&
        request.body.password === 'new-study-pass-2026',
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '할 일 저장' })).toBeVisible();
});
