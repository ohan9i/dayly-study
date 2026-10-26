import { expect, test } from '@playwright/test';
import { todayKey, addDays, normalizeTask } from '../../src/domain';
import { mockCloud, signIn, SHARED_SPACE, PDF, PNG } from './cloud-fixture';

test.setTimeout(60_000);

test('copy resets progress, leaves records/files and original untouched, and can be edited independently', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { nativeDetails: false });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('원본 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('순열');
  await page.getByRole('button', { name: '세부 항목 추가', exact: true }).click();
  await page.getByLabel('세부 항목 2', { exact: true }).fill('오답');
  await page
    .getByLabel('파일 첨부', { exact: true })
    .setInputFiles({ name: '원본.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('checkbox', { name: '원본 계획 세부 항목 1 완료', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '원본 계획 세부 항목 1 완료', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '순열 기록 열기', exact: true }).click();
  if (await page.getByRole('button', { name: '기록 작성', exact: true }).last().isVisible())
    await page.getByRole('button', { name: '기록 작성', exact: true }).last().click();
  await page.locator('.detail-record-form textarea').fill('원본의 풀이 기록');
  await page
    .getByLabel('수행 파일 첨부', { exact: true })
    .setInputFiles({ name: '풀이.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '기록 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toContainText('원본의 풀이 기록');
  await expect(page.locator('.detail-record-form')).toHaveCount(0);
  const before = structuredClone(cloud.tasks()[0]);
  const storedFiles = [...cloud.objects.keys()];
  const taskWrites = () =>
    cloud.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/rpc/duplicate_task')
      .length;
  const writeCount = taskWrites();
  await page.getByRole('button', { name: '원본 계획 상세 보기' }).click();
  await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
  await expect(page.getByLabel('복제할 날짜')).toHaveValue(todayKey());
  await expect(page.locator('.task-duplicate-picker')).toContainText('나의 공부 공간');
  await page.getByLabel('복제할 날짜').fill(addDays(todayKey(), 1));
  await page.route('https://*.supabase.co/rest/v1/rpc/duplicate_task', async (route) => {
    if (route.request().method() === 'POST')
      await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback();
  });
  // Ordinary submit still locks duplicate requests while the first is pending.
  await page.locator('.task-duplicate-picker').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(cloud.tasks()).toHaveLength(2);
  expect(cloud.tasks()[0]).toEqual(before);
  expect([...cloud.objects.keys()]).toEqual(storedFiles);
  expect(taskWrites() - writeCount).toBe(1);
  const copy = normalizeTask(cloud.tasks()[1]);
  expect(copy.details).toEqual(['순열', '오답']);
  expect(
    copy.detailChecks!.every(
      (check) => !check.completed && !check.completedBy && !check.completedAt,
    ),
  ).toBe(true);
  expect(copy.detailChecks!.map((check) => check.id)).not.toEqual(
    normalizeTask(before).detailChecks!.map((check) => check.id),
  );
  expect(copy.id).not.toBe(before.id);
  await expect(page.locator('.task-note')).toHaveCount(0);
  await expect(page.locator('.task-file-count')).toHaveCount(0);
  await expect(page.getByRole('progressbar', { name: '이날 진행률', exact: true })).toHaveAttribute(
    'aria-valuenow',
    '0',
  );
  await page.getByRole('button', { name: '원본 계획 상세 보기' }).click();
  await page.getByLabel('할 일', { exact: true }).fill('복제본만 수정');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('새 순열');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(cloud.tasks()[0]).toEqual(before);
  await page.reload();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  // The original remains available, with its recorded work and file bytes.
  await page.locator('.calendar-day.is-today').click();
  if (await page.locator('.month-preview-open').isVisible())
    await page.locator('.month-preview-open').click();
  await page.getByRole('button', { name: '순열 기록 열기', exact: true }).click();
  if (await page.getByRole('button', { name: '기록 작성', exact: true }).last().isVisible())
    await page.getByRole('button', { name: '기록 작성', exact: true }).last().click();
  await expect(page.locator('.task-note')).toContainText('원본의 풀이 기록');
  await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
});

test('approved participant copies another author while content stays read-only', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
  await expect(page.locator('.task-read-view h3')).toBeVisible();
  await expect(page.locator('input[name=title]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다른 플래너로 이동', exact: true })).toBeEnabled();
  const source = structuredClone(cloud.tasks()[0]);
  await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
  await page.getByRole('button', { name: '계획 복제', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(cloud.tasks()).toHaveLength(2);
  const copy = normalizeTask(cloud.tasks()[1]);
  expect(copy.created_by).toBe('10000000-0000-0000-0000-000000000001');
  expect(copy.created_by).not.toBe(source.created_by);
  expect(copy.workspace_id).toBe(SHARED_SPACE);
  expect(cloud.tasks()[0]).toEqual(source);
});

for (const stage of ['denied', 'missing-server-update'])
  test(`${stage} cannot leave a partial copy`, async ({ page }) => {
    const cloud = await mockCloud(page, { approved: true });
    await page.goto('/#planner');
    await signIn(page);
    await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
    await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
    await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
    const requestedDate = addDays(todayKey(), 2);
    await page.getByLabel('복제할 날짜').fill(requestedDate);
    await page.route('https://*.supabase.co/rest/v1/rpc/duplicate_task', async (route) => {
      return route.fulfill({
        status: stage === 'denied' ? 403 : 404,
        contentType: 'application/json',
        body: JSON.stringify({
          code: stage === 'denied' ? '42501' : 'PGRST202',
          message: 'Unavailable',
        }),
      });
    });
    await page.getByRole('button', { name: '계획 복제', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
      stage === 'denied' ? '복제 권한' : '서버 업데이트',
    );
    await expect(page.getByLabel('복제할 날짜')).toHaveValue(requestedDate);
    expect(cloud.tasks()).toHaveLength(1);
    expect(
      cloud.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/tasks'),
    ).toHaveLength(0);
  });

test('signed-out visitors have no copy action', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await expect(page.getByRole('button', { name: '이 계획 복제', exact: true })).toHaveCount(0);
});

test('an unrelated completion read failure does not lock a server-authorized copy', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install();
  await page.goto('/#planner');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
  await page.route('https://*.supabase.co/rest/v1/task_completions*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        code: '42501',
        message: 'permission denied for table task_completions',
      }),
    }),
  );
  cloud.externalCheck(cloud.tasks()[0].id, 0, true);
  await page.clock.runFor(6000);
  await page.clock.resume();
  await expect(page.locator('.error-banner')).toContainText('접근 권한');
  await expect(page.getByRole('button', { name: '이 계획 복제', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
  await page.getByRole('button', { name: '계획 복제', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(cloud.tasks()).toHaveLength(2);
  expect(cloud.tasks()[1].created_by).not.toBe(cloud.tasks()[0].created_by);
});
