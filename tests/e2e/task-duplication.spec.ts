import { expect, test } from '@playwright/test';
import { todayKey, addDays, normalizeTask } from '../../src/domain';
import { mockCloud, signIn, SHARED_SPACE, PDF, PNG } from './cloud-fixture';

test('copy resets progress, leaves records/files and original untouched, and can be edited independently', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { nativeDetails: false });
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('원본 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('순열');
  await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
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
    cloud.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/tasks').length;
  const writeCount = taskWrites();
  await page.getByRole('button', { name: '원본 계획 상세 보기' }).click();
  await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
  await expect(page.getByLabel('복제할 날짜')).toHaveValue(todayKey());
  await expect(page.locator('.task-duplicate-picker')).toContainText('나의 공부 공간');
  await page.getByLabel('복제할 날짜').fill(addDays(todayKey(), 1));
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (route.request().method() === 'POST')
      await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback();
  });
  // Dispatch two submissions in one JS turn, before React has rendered disabled.
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
  await page.getByRole('button', { name: '순열 기록 열기', exact: true }).click();
  await expect(page.locator('.task-note')).toContainText('원본의 풀이 기록');
  await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
});

test('approved participant copies another author without gaining edit or move rights', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.goto('/');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '다른 플래너로 이동', exact: true })).toHaveCount(
    0,
  );
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

for (const stage of ['read', 'insert'])
  test(`denied ${stage} cannot leave a partial copy`, async ({ page }) => {
    const cloud = await mockCloud(page, { approved: true });
    await page.goto('/');
    await signIn(page);
    await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
    await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
    await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
    const requestedDate = addDays(todayKey(), 2);
    await page.getByLabel('복제할 날짜').fill(requestedDate);
    await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
      const req = route.request();
      const sourceRead = req.method() === 'GET' && new URL(req.url()).searchParams.has('id');
      if ((stage === 'read' && sourceRead) || (stage === 'insert' && req.method() === 'POST'))
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ code: '42501', message: '복제 권한이 없어요.' }),
        });
      await route.fallback();
    });
    await page.getByRole('button', { name: '계획 복제', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('복제 권한');
    await expect(page.getByLabel('복제할 날짜')).toHaveValue(requestedDate);
    expect(cloud.tasks()).toHaveLength(1);
    if (stage === 'read')
      expect(
        cloud.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/tasks'),
      ).toHaveLength(0);
  });

test('signed-out visitors have no copy action', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await expect(page.getByRole('button', { name: '이 계획 복제', exact: true })).toHaveCount(0);
});
