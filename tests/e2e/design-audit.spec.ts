import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn, OWN_SPACE, SHARED_SPACE, PNG } from './cloud-fixture';
import { todayKey } from '../../src/domain';

async function seed(page: Parameters<typeof mockCloud>[0]) {
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'audit-plan',
        workspace_id: OWN_SPACE,
        created_by: '10000000-0000-0000-0000-000000000001',
        title: '구조역학의 전단력과 휨모멘트를 학습하고 설계 예제를 정리하는 긴 계획 제목',
        date: todayKey(),
        details: '전단력 선도와 휨모멘트 계산 과정을 길게 정리하기\n오답 정리',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  return cloud;
}
async function write(page: Parameters<typeof mockCloud>[0]) {
  await page.locator('.detail-record-toggle').first().click();
  await page.getByRole('button', { name: '기록 작성', exact: true }).click();
}

test('draft text and files survive folding, date, menu and workspace navigation; text restores on reload', async ({
  page,
}) => {
  await seed(page);
  await write(page);
  const input = page.locator('.detail-record-form textarea');
  await expect(input).toBeFocused();
  await input.fill('다시 돌아와도 남아야 할 작성 내용');
  await page
    .getByLabel('수행 파일 첨부', { exact: true })
    .setInputFiles({ name: '초안.png', mimeType: 'image/png', buffer: PNG });
  await page.locator('.detail-record-toggle').first().click();
  await page.locator('.detail-record-toggle').first().click();
  await expect(input).toHaveValue('다시 돌아와도 남아야 할 작성 내용');
  await expect(page.locator('.file-queue')).toContainText('초안.png');
  await page.getByRole('button', { name: '이전 날짜', exact: true }).click();
  await page.getByRole('button', { name: '다음 날짜', exact: true }).click();
  await expect(input).toHaveValue('다시 돌아와도 남아야 할 작성 내용');
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(input).toHaveValue('다시 돌아와도 남아야 할 작성 내용');
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await expect(input).toHaveCount(0);
  await page.getByLabel('사용 공간 선택').selectOption(OWN_SPACE);
  await expect(input).toHaveValue('다시 돌아와도 남아야 할 작성 내용');
  await expect(page.locator('.file-queue')).toContainText('초안.png');
  page.on('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await page.locator('.detail-record-toggle').first().click();
  await expect(input).toHaveValue('다시 돌아와도 남아야 할 작성 내용');
  await expect(page.locator('.file-queue')).toHaveCount(0);
  await expect(page.locator('.detail-record-form')).toContainText('새로고침하면 다시 첨부');
});

test('retry after one successful attachment and one failure does not duplicate the note or file', async ({
  page,
}) => {
  const cloud = await seed(page);
  await write(page);
  await page.locator('.detail-record-form textarea').fill('부분 실패 재시도');
  await page.getByLabel('수행 파일 첨부', { exact: true }).setInputFiles([
    { name: '첫째.png', mimeType: 'image/png', buffer: PNG },
    { name: '둘째.png', mimeType: 'image/png', buffer: PNG },
  ]);
  let uploads = 0;
  await page.route('https://*.supabase.co/storage/v1/object/**', async (route) => {
    if (
      route.request().method() === 'POST' &&
      !new URL(route.request().url()).pathname.includes('/sign/') &&
      ++uploads === 2
    )
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'upload failed' }),
      });
    else await route.fallback();
  });
  await page.getByRole('button', { name: '기록 저장', exact: true }).click();
  await expect(page.locator('.detail-record-form [role=alert]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.file-queue li')).toHaveCount(1);
  await page.locator('.detail-record-toggle').first().click();
  await page.locator('.detail-record-toggle').first().click();
  await page.getByRole('button', { name: '다시 저장', exact: true }).click();
  await expect(page.locator('.task-note')).toHaveCount(1);
  await expect(page.locator('.task-note .attachment-card')).toHaveCount(2);
  expect(cloud.objects.size).toBe(2);
  expect(
    cloud.requests.filter((r) => r.method === 'POST' && r.path === '/rest/v1/task_notes'),
  ).toHaveLength(1);
});

test('unsaved plan edits require a discard choice for Escape, close and backdrop', async ({
  page,
}) => {
  await seed(page);
  await page.locator('.task-title').first().click();
  await expect(page.locator('input[name=title]')).toHaveCount(0);
  await page.getByRole('button', { name: '계획 편집', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('아직 저장하지 않은 수정');
  for (const close of ['escape', 'button', 'backdrop']) {
    if (close === 'escape') await page.keyboard.press('Escape');
    else if (close === 'button')
      await page.getByRole('button', { name: '닫기', exact: true }).click();
    else await page.locator('dialog.modal').click({ position: { x: 1, y: 1 } });
    await expect(page.getByRole('dialog').last()).toContainText('작성 중인 변경');
    await page.getByRole('button', { name: '계속 편집', exact: true }).click();
    await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('아직 저장하지 않은 수정');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '변경 버리기', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('statistics date filtering keeps the view, navigation reveals the heading, and search shows matching detail', async ({
  page,
}) => {
  await seed(page);
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await expect(page.locator('#planner')).toBeFocused();
  await page.getByRole('button', { name: '이전 날짜', exact: true }).click();
  await expect(page.locator('#planner')).toHaveText('학습 흐름');
  await expect(page.locator('.stats-range')).toContainText('최근 7일');
  await page.getByRole('button', { name: '할 일 검색', exact: true }).click();
  await expect(page.getByLabel('할 일 검색어')).toBeFocused();
  await page.getByLabel('할 일 검색어').fill('전단력 선도');
  await expect(page.locator('.search-match mark')).toHaveText('전단력 선도');
  await page.locator('.search-results > button').click();
  await expect(page.locator('.detail-record-toggle').first()).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#planner')).toContainText('계획');
});

for (const width of [320, 390, 420, 768, 1440])
  for (const theme of ['morning', 'night']) {
    test(`readable UI, visible selected state and no overflow at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('dayly.atmosphere', value), theme);
      await seed(page);
      await write(page);
      await page
        .locator('.detail-record-form textarea')
        .fill('긴 제목과 작성창 배치를 확인합니다.');
      await page.mouse.move(0, 0);
      const toggle = page.locator('.detail-record-toggle').first();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
        'rgba(0, 0, 0, 0)',
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      const boxes = await page
        .locator('.detail-row-main')
        .first()
        .evaluate((el) =>
          Array.from(el.children).map((child) => child.getBoundingClientRect().top),
        );
      expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(12);
      if (width < 1000)
        expect(
          await page.locator('.tasks-card').evaluate((el) => el.getBoundingClientRect().top),
        ).toBeLessThan(
          await page.locator('.planner-moment').evaluate((el) => el.getBoundingClientRect().top),
        );
      await page.evaluate(() => document.fonts.ready);
      mkdirSync('.local/audit', { recursive: true });
      await page.screenshot({
        path: `.local/audit/${width}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });
      await page.locator('.plan-actions > summary').click();
      await expect(page.locator('.plan-actions-menu')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
