import { expect, test } from '@playwright/test';
import { mockCloud, signIn, PNG } from './cloud-fixture';

test('approved member can recover a deleted plan with its original file', async ({ page }) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('영구 보존 계획');
  await page
    .getByLabel('파일 첨부', { exact: true })
    .setInputFiles({ name: '보존.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '영구 보존 계획 상세 보기', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 할 일 삭제', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '보존.png 삭제', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '다른 플래너로 이동', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '이 할 일 삭제', exact: true }).click({ delay: 2150 });
  await expect(page.getByRole('dialog')).toContainText('휴지통으로 보낼까요?');
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '영구 보존 계획 상세 보기', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  expect(cloud.objects.size).toBe(1);
  expect(cloud.requests.some((r) => r.method === 'DELETE')).toBe(false);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.retention-status')).toContainText('복구 보호 적용됨');
  await page.getByRole('button', { name: '영구 보존 계획 복원', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '영구 보존 계획 상세 보기', exact: true }),
  ).toBeVisible();
  expect(cloud.objects.size).toBe(1);
});
test('missing or disabled server protection is clearly reported', async ({ page }) => {
  await mockCloud(page);
  await page.route('https://*.supabase.co/rest/v1/rpc/get_planner_retention_status', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202' }),
    }),
  );
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.retention-status')).toContainText(
    '서버 보존 보호를 확인하지 못했어요',
  );
  await page.route('https://*.supabase.co/rest/v1/rpc/get_planner_retention_status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 1, enabled: false }),
    }),
  );
  await page.getByRole('button', { name: '보호 상태 새로고침', exact: true }).click();
  await expect(page.locator('.retention-status')).toContainText(
    '서버 보존 보호를 확인하지 못했어요',
  );
});

test('backup status only reports a confirmed upload and revoked history access is explained', async ({
  page,
}) => {
  await mockCloud(page);
  await page.route('https://*.supabase.co/rest/v1/rpc/get_workspace_backup_status', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ last_completed_at: new Date().toISOString() }),
    }),
  );
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.backup-status')).toContainText('마지막 백업 성공:');
  await page.route('https://*.supabase.co/rest/v1/task_deletion_history*', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'Access denied' }),
    }),
  );
  await page.getByRole('button', { name: '보호 상태 새로고침', exact: true }).click();
  await expect(page.locator('.data-protection')).toContainText(
    '보호 기능 정보를 불러오지 못했어요',
  );
  await expect(page.locator('.workspace-options button[aria-pressed="true"]')).toContainText(
    '나의 공부 공간',
  );
});
