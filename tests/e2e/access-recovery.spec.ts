import { expect, test } from '@playwright/test';
import { mockCloud, signIn, OWN_SPACE, SHARED_SPACE } from './cloud-fixture';
import { todayKey } from '../../src/domain';

const retainedTask = {
  id: '30000000-0000-0000-0000-000000000088',
  workspace_id: OWN_SPACE,
  created_by: '10000000-0000-0000-0000-000000000001',
  title: '보존된 구조역학 계획',
  date: todayKey(),
  details: '문제 풀기',
};

test('ordinary logout only revokes the current device session', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '내 계정', exact: true }).click();
  const logout = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/auth/v1/logout',
  );
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  expect(new URL((await logout).url()).searchParams.get('scope')).toBe('local');
  await expect(page.getByRole('button', { name: '공유 기록 새로고침', exact: true })).toHaveCount(
    0,
  );
});

test('failed auxiliary read preserves plans, blocks record operations, and recovers online without resetting drafts', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { tasks: [retainedTask] });
  let denied = true;
  await page.route('https://*.supabase.co/rest/v1/task_notes*', async (route) => {
    if (denied)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'permission denied for table task_notes', code: '42501' }),
      });
    await route.fallback();
  });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  await expect(page.getByRole('alert')).toContainText('수행 기록을 불러오지 못했어요');
  await page.getByRole('checkbox', { name: '보존된 구조역학 계획 완료', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('수행 기록을 불러오지 못했어요');
  await page.getByRole('button', { name: '보존된 구조역학 계획 상세 보기' }).click();
  const title = page.getByLabel('할 일', { exact: true });
  await title.fill('입력 중인 초안');
  await expect(page.getByRole('button', { name: '이 할 일 삭제', exact: true })).toBeEnabled();
  await expect(page.getByLabel('파일 첨부', { exact: true })).toHaveCount(0);
  expect(cloud.tasks()).toHaveLength(1);
  denied = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(title).toHaveValue('입력 중인 초안');
  await expect(title).toBeFocused();
  await expect(page.getByRole('button', { name: '이 할 일 삭제', exact: true })).toBeEnabled();
});

test('failed initial core read recovers through the bounded retry timer', async ({ page }) => {
  await mockCloud(page, { tasks: [retainedTask] });
  let denied = true;
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (denied)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: '42501', message: 'temporary access failure' }),
      });
    await route.fallback();
  });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  await expect(page.getByText('내 공간을 아직 불러오지 못했어요.', { exact: true })).toBeVisible();
  denied = false;
  await page.clock.runFor(11000);
  await expect(page.getByRole('button', { name: '보존된 구조역학 계획 상세 보기' })).toBeVisible();
  await expect(page.locator('.onboarding-banner')).toHaveCount(0);
});

test('unavailable shared space is cleared and explained even when fallback loading fails', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toBeVisible();
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    const space = new URL(route.request().url()).searchParams.get('workspace_id');
    if (space === `eq.${OWN_SPACE}`)
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: '42501', message: 'fallback unavailable' }),
      });
    await route.fallback();
  });
  cloud.revokeShared();
  await page.clock.runFor(6000);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toHaveCount(0);
  await expect(page.getByText(/“함께 공부하는 공간”에 접근할 수 없어요/)).toBeVisible();
  expect(cloud.tasks()).toHaveLength(1);
  await page.unroute('https://*.supabase.co/rest/v1/tasks*');
  await page.getByRole('button', { name: '공유 기록 새로고침', exact: true }).click();
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(OWN_SPACE);
  await expect(page.getByText(/“함께 공부하는 공간”에 접근할 수 없어요/)).toBeVisible();
});

test('automatic initialization retries stop after three attempts while manual refresh remains available', async ({
  page,
}) => {
  await mockCloud(page);
  let reads = 0;
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    reads++;
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'denied' }),
    });
  });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  for (let i = 0; i < 3; i++) {
    await page.clock.runFor(10000);
    await expect.poll(() => reads).toBe(i + 2);
    await expect(
      page.getByRole('button', { name: '공유 기록 새로고침', exact: true }),
    ).toBeEnabled();
  }
  await page.clock.runFor(40000);
  expect(reads).toBe(4);
});
