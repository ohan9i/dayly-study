import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockCloud, signIn, OWN_SPACE, PNG } from './cloud-fixture';
import { todayKey } from '../../src/domain';

test('deleting a plan archives its contents and attachment list and settings offers a history download', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('삭제 이력으로 보관할 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('풀이 과정 보관');
  await page
    .getByLabel('파일 첨부', { exact: true })
    .setInputFiles({ name: '풀이.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('button', { name: '삭제 이력으로 보관할 계획 상세 보기', exact: true })
    .click();
  await page.getByRole('button', { name: '이 할 일 삭제', exact: true }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.locator('.deletion-list')).toContainText('삭제 이력으로 보관할 계획');
  await expect(page.locator('.deletion-list')).toContainText('삭제: 나');
  await expect(page.getByText('아직 성공한 정기 백업이 확인되지 않았어요.')).toBeVisible();
  const event = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '삭제 이력으로 보관할 계획 삭제 이력 내려받기', exact: true })
    .click();
  const archive = JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
  expect(archive.snapshot.task.title).toBe('삭제 이력으로 보관할 계획');
  expect(archive.snapshot.attachments[0].filename).toBe('풀이.png');
});
test('missing deletion migration stops before removing either the plan or its original files', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('보호 설정 전 삭제 금지');
  await page
    .getByLabel('파일 첨부', { exact: true })
    .setInputFiles({ name: '보존.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.route('https://*.supabase.co/rest/v1/rpc/prepare_task_deletion', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST202', message: 'Missing function' }),
    }),
  );
  await page.getByRole('button', { name: '보호 설정 전 삭제 금지 상세 보기', exact: true }).click();
  await page.getByRole('button', { name: '이 할 일 삭제', exact: true }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('삭제를 중단했어요');
  expect(cloud.tasks()).toHaveLength(1);
  expect(cloud.objects.size).toBe(1);
  expect(
    cloud.requests.some((r) => r.path === '/storage/v1/object/task-files' && r.method === 'DELETE'),
  ).toBe(false);
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
  await page.goto('/');
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
