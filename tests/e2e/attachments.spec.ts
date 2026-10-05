import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockCloud, signIn, OWN_SPACE, SHARED_SPACE, PNG, PDF } from './cloud-fixture';

test('task files and compact performance notes survive reload, preview, download and delete', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cloud = await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('보의 휨 설계 수행');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('예제의 조건을 확인하고 풀이하기');
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles([
    { name: '설계 문제.pdf', mimeType: 'application/pdf', buffer: PDF },
    { name: '참고 사진.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.locator('.file-queue li')).toHaveCount(2);
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByLabel('첨부 파일 2개')).toBeVisible();
  await page.getByRole('button', { name: '보의 휨 설계 수행 상세 보기' }).click();
  await expect(page.locator('.attachment-card')).toHaveCount(2);
  await page.getByRole('button', { name: '참고 사진.png 보기', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '참고 사진.png', exact: true })).toBeVisible();
  await expect(page.locator('.file-preview img')).toHaveJSProperty('naturalWidth', 1);
  await page.getByRole('button', { name: '파일 미리보기 닫기' }).click();
  await page.getByRole('button', { name: '설계 문제.pdf 보기', exact: true }).click();
  await expect(page.getByTitle('설계 문제.pdf PDF 미리보기')).toBeVisible();
  await page.getByRole('button', { name: '파일 미리보기 닫기' }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '설계 문제.pdf 내려받기' }).click();
  const download = await downloadEvent;
  expect(readFileSync((await download.path())!).equals(PDF)).toBe(true);
  await page.getByText('수행 내용 남기기', { exact: true }).click();
  await page.getByLabel('수행 내용', { exact: true }).fill('중립축 깊이와 휨 강도를 계산했습니다.');
  await page
    .getByLabel('수행 파일 첨부', { exact: true })
    .setInputFiles({ name: '풀이 사진.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toContainText('중립축 깊이와 휨 강도를 계산했습니다.');
  await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: '.local/preview-task-materials.png', fullPage: true });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('첨부 파일 3개')).toBeVisible();
  await page.getByRole('button', { name: '보의 휨 설계 수행 상세 보기' }).click();
  await expect(page.locator('.task-note')).toContainText('중립축 깊이와 휨 강도를 계산했습니다.');
  await page.getByRole('button', { name: '수행 내용 수정', exact: true }).click();
  await page.getByLabel('수행 내용 수정 글').fill('강도 검토까지 완료했습니다.');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toContainText('강도 검토까지 완료했습니다.');
  await page.getByRole('button', { name: '이 할 일 삭제' }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByText('여백이 있는 하루', { exact: true })).toBeVisible();
  expect(cloud.objects.size).toBe(0);
  const lastDelete = cloud.requests.filter((r) => r.method === 'DELETE');
  expect(lastDelete.at(-3)?.path).toBe('/storage/v1/object/task-files');
  expect(lastDelete.at(-2)?.path).toBe('/rest/v1/task_attachments');
  expect(lastDelete.at(-1)?.path).toBe('/rest/v1/tasks');
  expect(errors).toEqual([]);
});

test('failed uploads retain the queue and retry without duplicating the task or successful files', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('업로드 재시도');
  await page
    .getByLabel('파일 첨부', { exact: true })
    .setInputFiles({ name: '문제.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(page.locator('.file-queue li')).toHaveCount(1);
  cloud.failNextUpload();
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    '할 일은 저장되어 있어요',
  );
  await expect(page.locator('.file-queue li')).toHaveCount(1);
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(
    cloud.requests.filter((r) => r.path === '/rest/v1/tasks' && r.method === 'POST'),
  ).toHaveLength(1);
  expect(cloud.objects.size).toBe(1);
  await expect(page.getByLabel('첨부 파일 1개')).toBeVisible();
  await page.getByRole('button', { name: '업로드 재시도 상세 보기' }).click();
  await page.getByText('수행 내용 남기기', { exact: true }).click();
  await page.getByLabel('수행 내용', { exact: true }).fill('글 저장 후 사진 재시도');
  await page
    .getByLabel('수행 파일 첨부', { exact: true })
    .setInputFiles({ name: '풀이.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.file-queue li')).toHaveCount(1);
  cloud.failNextUpload();
  await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
  await expect(page.locator('.note-composer').getByRole('alert')).toContainText(
    '글은 저장되어 있어요',
  );
  await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toHaveCount(1);
  await expect(page.locator('.task-note .attachment-card')).toHaveCount(1);
  expect(
    cloud.requests.filter((r) => r.path === '/rest/v1/task_notes' && r.method === 'POST'),
  ).toHaveLength(1);
  expect(cloud.objects.size).toBe(2);
});

test('a newly registered member gets a private space and can add notes in approved spaces', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { approved: true, startWithoutOwnSpace: true });
  await page.goto('/');
  await signIn(page);
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(OWN_SPACE);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toHaveCount(0);
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByLabel('내 공간 이름', { exact: true }).fill('나의 구조 설계 공간');
  await page.getByRole('button', { name: '공간 이름 저장', exact: true }).click();
  await expect(page.locator('.workspace-group').first()).toContainText('나의 구조 설계 공간');
  await expect(page.locator('.workspace-group')).toHaveCount(2);
  await expect(page.locator('.workspace-group').first()).toContainText('내 공간');
  await expect(page.locator('.workspace-group').last()).toContainText('승인받은 공간');
  await page.getByRole('button', { name: '함께 공부하는 공간 작성자로 참여', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '함께 공부하는 공간 작성자로 참여', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(SHARED_SPACE);
  await expect(page.getByRole('checkbox', { name: '공유한 구조역학 문제 완료' })).toBeDisabled();
  await page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('파일 첨부', { exact: true })).toBeEnabled();
  await page.getByText('수행 내용 남기기', { exact: true }).click();
  await page.getByLabel('수행 내용', { exact: true }).fill('풀이를 수행했습니다.');
  await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toContainText('풀이를 수행했습니다.');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.reload();
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(SHARED_SPACE);
  cloud.revokeShared();
  await page.getByRole('button', { name: '공유 기록 새로고침' }).click();
  await expect(page.getByLabel('사용 공간 선택')).toHaveValue(OWN_SPACE);
  await expect(page.getByRole('button', { name: '공유한 구조역학 문제 상세 보기' })).toHaveCount(0);
});

test('mobile detail stays compact and rejects oversized, unsupported and too many files before saving', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles({
    name: '파일.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('test'),
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('PDF, JPG, PNG, WebP');
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles({
    name: '큰 파일.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('10MB');
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles({
    name: '확장자만 변경.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('확장자만 바꾼 파일');
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles(
    Array.from({ length: 6 }, (_, i) => ({
      name: `사진${i}.png`,
      mimeType: 'image/png',
      buffer: PNG,
    })),
  );
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('5개');
  await expect(page.locator('.file-queue li')).toHaveCount(0);
  await page.getByLabel('할 일', { exact: true }).fill('모바일 첨부 파일과 수행 내용');
  await page.getByLabel('파일 첨부', { exact: true }).setInputFiles({
    name: '길이가 긴 참고 사진 이름을 사용하는 첨부 자료.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(page.locator('.file-queue li')).toHaveCount(1);
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await page.getByRole('button', { name: '모바일 첨부 파일과 수행 내용 상세 보기' }).click();
  await page.getByText('수행 내용 남기기', { exact: true }).click();
  await page.getByLabel('수행 내용', { exact: true }).fill('휴대폰에서도 간단하게 기록합니다.');
  await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
  expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.local/preview-task-materials-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  const date = page.locator('.date-display').first();
  expect(await date.evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px');
  await expect(page.getByRole('button', { name: '이전 날짜' })).toHaveCSS('height', '44px');
  expect(await page.locator('body').textContent()).not.toContain('·');
});
