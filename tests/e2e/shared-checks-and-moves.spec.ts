import { expect, test, type Page } from '@playwright/test';
import { todayKey, normalizeTask } from '../../src/domain';
import { mockCloud, OWN_SPACE, SHARED_SPACE, signIn, PDF, PNG } from './cloud-fixture';

async function select(page: Page, id: string) {
  await page.getByLabel('사용 공간 선택').selectOption(id);
  await expect(page.getByRole('button', { name: '공유 기록 새로고침', exact: true })).toBeEnabled();
}
test('approved participant checks parent and subtask in home/detail while content and move stay restricted', async ({
  page,
}) => {
  await mockCloud(page, { approved: true });
  await page.goto('/');
  await signIn(page);
  await select(page, SHARED_SPACE);
  const parent = page.getByRole('checkbox', { name: '공유한 구조역학 문제 완료', exact: true });
  await parent.click();
  await expect(parent).toBeEnabled();
  await expect(parent).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('세부 항목 1', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('button', { name: '다른 플래너로 이동', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: '이 할 일 삭제', exact: true })).toHaveCount(0);
  const sub = page
    .getByRole('dialog')
    .getByRole('checkbox', { name: '세부 항목 1 완료', exact: true });
  await sub.click();
  await expect(sub).toBeEnabled();
  await expect(sub).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(parent).toHaveAttribute('aria-checked', 'false');
});

for (const width of [1440, 390])
  test(`moves an authored task with subtask records and files into own space at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const cloud = await mockCloud(page, { approved: true });
    await page.goto('/');
    await signIn(page);
    await select(page, SHARED_SPACE);
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page.getByLabel('할 일', { exact: true }).fill('잘못 쓴 플래너 항목');
    await page.getByLabel('세부 항목 1', { exact: true }).fill('풀이');
    await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
    await page.getByLabel('세부 항목 2', { exact: true }).fill('정리');
    await page
      .getByLabel('파일 첨부', { exact: true })
      .setInputFiles({ name: '원본.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page
      .getByRole('checkbox', { name: '잘못 쓴 플래너 항목 세부 항목 1 완료', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: '잘못 쓴 플래너 항목 세부 항목 1 완료', exact: true }),
    ).toBeEnabled();
    await page.getByRole('button', { name: '풀이 기록 열기', exact: true }).click();
    await page.locator('.detail-record-form textarea').fill('이동 후에도 남아야 하는 풀이');
    await page
      .getByLabel('수행 파일 첨부', { exact: true })
      .setInputFiles({ name: '풀이.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: '기록 저장', exact: true }).click();
    await expect(page.locator('.task-note')).toContainText('이동 후에도 남아야 하는 풀이');
    await expect(page.locator('.detail-record-form')).toHaveCount(0);
    await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
    const before = structuredClone(
      cloud.tasks().find((task) => task.title === '잘못 쓴 플래너 항목')!,
    );
    const paths = [...cloud.objects.keys()];
    await page.getByRole('button', { name: '잘못 쓴 플래너 항목 상세 보기', exact: true }).click();
    await page.getByRole('button', { name: '다른 플래너로 이동', exact: true }).click();
    await expect(page.getByLabel('이동할 공간')).toHaveValue(OWN_SPACE);
    await expect(page.getByLabel('이동할 공간').locator('option')).toHaveCount(1);
    await page.screenshot({ path: `.local/shared-move-${width}-picker.png`, fullPage: true });
    await page.getByRole('button', { name: '이동', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('status')).toContainText('내 플래너로 이동했습니다.');
    await expect(page.getByLabel('사용 공간 선택')).toHaveValue(OWN_SPACE);
    await expect(
      page.getByRole('progressbar', { name: '잘못 쓴 플래너 항목 진행률', exact: true }),
    ).toHaveAttribute('aria-valuenow', '50');
    await expect(
      page.getByRole('progressbar', { name: '오늘 진행률', exact: true }),
    ).toHaveAttribute('aria-valuenow', '50');
    const moved = cloud.tasks().find((task) => task.id === before.id)!;
    expect({ ...moved, workspace_id: before.workspace_id }).toEqual(before);
    expect([...cloud.objects.keys()]).toEqual(paths);
    await expect(page.locator('.task-note')).toContainText('이동 후에도 남아야 하는 풀이');
    await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
    await select(page, SHARED_SPACE);
    await expect(
      page.getByRole('button', { name: '잘못 쓴 플래너 항목 상세 보기', exact: true }),
    ).toHaveCount(0);
    await select(page, OWN_SPACE);
    await page.reload();
    await expect(
      page.getByRole('progressbar', { name: '오늘 진행률', exact: true }),
    ).toHaveAttribute('aria-valuenow', '50');
    await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
    await expect(page.locator('.stat-tile').first()).toContainText('1 / 2개');
    await page.screenshot({ path: `.local/shared-move-${width}.png`, fullPage: true });
  });

test('remote checks synchronize without resetting draft focus; stale form save retains the remote check', async ({
  page,
}) => {
  const taskId = '30000000-0000-0000-0000-000000000009';
  const cloud = await mockCloud(page, {
    tasks: [
      {
        id: taskId,
        workspace_id: OWN_SPACE,
        created_by: '10000000-0000-0000-0000-000000000001',
        title: '함께 체크',
        date: todayKey(),
        details: '첫 항목\n두 번째',
      },
    ],
  });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '함께 체크 상세 보기', exact: true }).click();
  const draft = page.getByLabel('세부 항목 1', { exact: true });
  await draft.fill('저장 전 초안');
  cloud.externalCheck(taskId, 1, true);
  await page.clock.runFor(6000);
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: '세부 항목 2 완료', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(draft).toHaveValue('저장 전 초안');
  await expect(draft).toBeFocused();
  await expect(draft).toBeEnabled();
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const saved = normalizeTask(cloud.tasks().find((task) => task.id === taskId)!);
  expect(saved.details[0]).toBe('저장 전 초안');
  expect(saved.detailChecks?.[1].completed).toBe(true);
  cloud.externalMove(taskId, SHARED_SPACE);
  await page.clock.runFor(6000);
  await expect(page.getByRole('button', { name: '함께 체크 상세 보기', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('여백이 있는 하루', { exact: true })).toBeVisible();
});

test('a new empty space keeps its draft without full reloads, and revoked membership clears shared data', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true, emptyActivity: true });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  const draft = page.getByLabel('할 일', { exact: true });
  await draft.fill('새 공간의 초안');
  const reads = () =>
    cloud.requests.filter(
      (request) => request.path === '/rest/v1/tasks' && request.method === 'GET',
    ).length;
  const before = reads();
  await page.clock.runFor(16000);
  await expect(draft).toHaveValue('새 공간의 초안');
  await expect(draft).toBeFocused();
  expect(reads()).toBe(before);
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await select(page, SHARED_SPACE);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toBeVisible();
  cloud.revokeShared();
  await page.clock.runFor(6000);
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(OWN_SPACE);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toHaveCount(0);
});

test('a remote change during manual refresh cannot leave the page permanently loading', async ({
  page,
}) => {
  const taskId = '30000000-0000-0000-0000-000000000010';
  const cloud = await mockCloud(page, {
    tasks: [
      {
        id: taskId,
        workspace_id: OWN_SPACE,
        created_by: '10000000-0000-0000-0000-000000000001',
        title: '갱신 중 공유 체크',
        date: todayKey(),
        details: '체크 항목',
      },
    ],
  });
  await page.clock.install();
  await page.goto('/');
  await signIn(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (route.request().method() === 'GET') await pending;
    await route.fallback();
  });
  const refresh = page.getByRole('button', { name: '공유 기록 새로고침', exact: true });
  await refresh.click();
  await expect(refresh).toBeDisabled();
  cloud.externalCheck(taskId, 0, true);
  await page.clock.runFor(6000);
  release();
  await expect(refresh).toBeEnabled();
  await expect(
    page.getByRole('checkbox', { name: '갱신 중 공유 체크 완료', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.loading-note')).toHaveCount(0);
});
