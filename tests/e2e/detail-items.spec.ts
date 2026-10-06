import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { PROGRESS_PREFIX, LOCAL_KEY, todayKey } from '../../src/domain';
import { mockCloud, signIn, OWN_SPACE } from './cloud-fixture';

const field = (page: Page, index: number) => page.getByLabel(`세부 항목 ${index}`, { exact: true });
const open = async (page: Page, title = '수학 공부') => {
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill(title);
};
const save = async (page: Page) => {
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
};
const edit = async (page: Page, title = '수학 공부') => {
  await page.getByRole('button', { name: `${title} 상세 보기`, exact: true }).click();
};
async function backup(page: Page) {
  await page.getByRole('button', { name: '설정', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '백업 내려받기' }).click();
  return JSON.parse(readFileSync((await (await download).path())!, 'utf8'));
}

test('title-only, one item and multiple items support ordered editing, empty filtering and main task CRUD', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const cloud = await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await open(page, '제목만 있는 계획');
  await save(page);
  await expect(page.locator('.task-details')).toHaveCount(0);
  await open(page);
  await field(page, 1).fill(' 순열 문제 10개 풀기 ');
  await save(page);
  await expect(page.locator('.task-details .detail-row-title')).toHaveText(['순열 문제 10개 풀기']);

  await edit(page);
  await expect(field(page, 1)).toHaveValue('순열 문제 10개 풀기');
  await field(page, 1).press('Enter');
  await expect(field(page, 2)).toBeFocused();
  await field(page, 2).fill('조건부확률 복습');
  await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
  await expect(field(page, 3)).toBeFocused();
  await field(page, 3).fill('오답노트 정리');
  // Enter inserts immediately below the current row, preserving the following row.
  await field(page, 1).press('Enter');
  await expect(field(page, 2)).toBeFocused();
  await field(page, 2).fill('중간 항목');
  await expect(field(page, 3)).toHaveValue('조건부확률 복습');
  await page.getByRole('button', { name: '세부 항목 2 삭제', exact: true }).click();
  await expect(field(page, 1)).toBeFocused();
  await expect(field(page, 2)).toHaveValue('조건부확률 복습');
  await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
  await field(page, 4).fill('   ');
  await field(page, 2).press('Enter');
  await expect(field(page, 3)).toBeFocused();
  await field(page, 3).press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await field(page, 3).press('Backspace');
  await expect(field(page, 2)).toBeFocused();
  await expect(page.locator('.detail-input-row')).toHaveCount(5);
  await save(page);
  await expect(page.locator('.task-details .detail-row-title')).toHaveText([
    '순열 문제 10개 풀기',
    '조건부확률 복습',
    '오답노트 정리',
  ]);
  await page.reload();
  await edit(page);
  await expect(page.locator('.detail-input-row')).toHaveCount(3);
  await expect(field(page, 3)).toHaveValue('오답노트 정리');
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('.local', { recursive: true });
  await page.screenshot({ path: '.local/detail-items-desktop-editor.png' });
  await page.getByRole('button', { name: '세부 항목 3 삭제', exact: true }).click();
  await expect(field(page, 2)).toBeFocused();
  await field(page, 2).fill('조건부확률 다시 복습');
  await save(page);
  await expect(page.locator('.task-details .detail-row-title')).toHaveText([
    '순열 문제 10개 풀기',
    '조건부확률 다시 복습',
  ]);
  await page.screenshot({ path: '.local/detail-items-desktop-home.png' });
  await page.getByRole('checkbox', { name: '수학 공부 완료', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '수학 공부 완료', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await edit(page);
  await page.getByRole('button', { name: '세부 항목 2 삭제', exact: true }).click();
  await page.getByRole('button', { name: '세부 항목 1 삭제', exact: true }).click();
  await expect(page.locator('.detail-input-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '한 줄 추가', exact: true })).toBeFocused();
  await save(page);
  await page.reload();
  await expect(page.locator('.task-details')).toHaveCount(0);
  await edit(page);
  await page.getByRole('button', { name: '이 할 일 삭제', exact: true }).click();
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(page.getByRole('button', { name: '수학 공부 상세 보기', exact: true })).toHaveCount(
    0,
  );
  const writes = cloud.requests.filter(
    (r) => r.path === '/rest/v1/tasks' && ['POST', 'PATCH'].includes(r.method),
  );
  expect(writes.every((r) => Array.isArray(r.body.detail_items))).toBe(true);
  expect(
    writes.every((r) => !Object.hasOwn(r.body, 'subject') && !Object.hasOwn(r.body, 'time')),
  ).toBe(true);
  expect((await backup(page)).tasks[0].details).toEqual([]);
  expect(errors).toEqual([]);
});

test('Korean composition Enter does not insert a row or submit; normal Enter resumes afterward', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/');
  await signIn(page);
  await open(page);
  const input = field(page, 1);
  await input.fill('조건부확률 복습');
  await input.dispatchEvent('compositionstart', { data: '습' });
  await input.press('Enter');
  await expect(page.locator('.detail-input-row')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toBeVisible();
  await input.dispatchEvent('compositionend', { data: '습' });
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
  await expect(page.locator('.detail-input-row')).toHaveCount(1);
  expect(
    cloud.requests.filter((r) => r.path === '/rest/v1/tasks' && r.method === 'POST'),
  ).toHaveLength(0);
  await input.press('Enter');
  await expect(field(page, 2)).toBeFocused();
  await field(page, 2).fill('오답 정리');
  await save(page);
  await expect(page.locator('.task-details .detail-row-title')).toHaveText(['조건부확률 복습', '오답 정리']);
});

test('legacy local memo and cloud string notes survive migration, editing and reload', async ({
  page,
}) => {
  const legacy = {
    id: '30000000-0000-0000-0000-000000000009',
    title: '기존 수학 계획',
    date: todayKey(),
    subject: '수학',
    time: '09:00',
    memo: '문제집 30페이지까지',
    created_by: '10000000-0000-0000-0000-000000000001',
  };
  await page.addInitScript(
    ({ key, task }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            tasks: [task],
            logs: [],
            completedTaskIds: [task.id],
            hasSamples: false,
          }),
        );
    },
    { key: LOCAL_KEY, task: legacy },
  );
  await mockCloud(page, {
    tasks: [
      { ...legacy, workspace_id: OWN_SPACE, details: '순열 복습\n\n 오답 정리', memo: undefined },
    ],
  });
  await page.goto('/');
  await expect(page.locator('.task-details .detail-row-title')).toHaveText(['문제집 30페이지까지']);
  await expect(page.getByRole('checkbox', { name: '기존 수학 계획 완료' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('.task-time, .task-row .tag')).toHaveCount(0);
  await signIn(page);
  await edit(page, legacy.title);
  await expect(field(page, 1)).toHaveValue('순열 복습');
  await expect(field(page, 2)).toHaveValue('오답 정리');
  await field(page, 2).fill('오답노트 정리');
  await save(page);
  await page.reload();
  await expect(page.locator('.task-details .detail-row-title')).toHaveText(['순열 복습', '오답노트 정리']);
  const data = await backup(page);
  expect(data.version).toBe(2);
  expect(data.tasks[0].subject).toBe('수학');
  expect(data.tasks[0].time).toBe('09:00');
  expect(data.tasks[0].details).toEqual(['순열 복습', '오답노트 정리']);
});

test('the existing text-only database stores a structured array and preserves it after reload', async ({
  page,
}) => {
  const cloud = await mockCloud(page, { nativeDetails: false });
  await page.goto('/');
  await signIn(page);
  await open(page);
  await field(page, 1).fill('순열 문제 10개');
  await field(page, 1).press('Enter');
  await field(page, 2).fill('오답 정리');
  await save(page);
  const writes = cloud.requests.filter((r) => r.path === '/rest/v1/tasks' && r.method === 'POST');
  expect(writes).toHaveLength(2); // An unknown column rejects the first request before any insertion.
  const stored = JSON.parse(String(writes[1].body.details).slice(PROGRESS_PREFIX.length));
  expect(stored.items.map((item: { text: string }) => item.text)).toEqual([
    '순열 문제 10개',
    '오답 정리',
  ]);
  await page.reload();
  await expect(page.locator('.task-details .detail-row-title')).toHaveText(['순열 문제 10개', '오답 정리']);
  await edit(page);
  await page.getByRole('button', { name: '세부 항목 2 삭제', exact: true }).click();
  await page.getByRole('button', { name: '세부 항목 1 삭제', exact: true }).click();
  await save(page);
  await page.reload();
  await expect(page.locator('.task-details')).toHaveCount(0);
});

test('permission errors keep the draft and never retry a different storage format', async ({
  page,
}) => {
  await mockCloud(page);
  let writes = 0;
  await page.route('https://*.supabase.co/rest/v1/tasks*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    writes++;
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: '42501', message: 'permission denied for detail_items' }),
    });
  });
  await page.goto('/');
  await signIn(page);
  await open(page);
  await field(page, 1).fill('저장 권한을 확인해도 유지할 초안');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('permission denied');
  await expect(field(page, 1)).toHaveValue('저장 권한을 확인해도 유지할 초안');
  expect(writes).toBe(1);
});

for (const width of [390, 360]) {
  test(`detail inputs and delete buttons remain separate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockCloud(page);
    await page.goto('/');
    await signIn(page);
    await open(page, '수학 공부와 오답노트 정리');
    for (let index = 1; index <= 12; index++) {
      await field(page, index).fill(
        index === 1
          ? '긴 세부 항목입니다. 조건부확률의 정의와 풀이 과정을 차근차근 다시 정리하기'
          : `복습 항목 ${index}`,
      );
      await field(page, index).press('Enter');
      await expect(field(page, index + 1)).toBeFocused();
    }
    const layout = await page
      .locator('.detail-input-row')
      .first()
      .evaluate((row) => {
        const input = row.querySelector('input[type="text"]')!.getBoundingClientRect();
        const button = row.querySelector('.detail-remove-button')!.getBoundingClientRect();
        const dialog = document.querySelector('dialog')!;
        return {
          inputWidth: input.width,
          gap: button.left - input.right,
          buttonWidth: button.width,
          overflow: dialog.scrollWidth > dialog.clientWidth,
        };
      });
    expect(layout.inputWidth).toBeGreaterThan(185);
    expect(layout.gap).toBeGreaterThanOrEqual(3);
    expect(layout.buttonWidth).toBeCloseTo(44, 2);
    expect(layout.overflow).toBe(false);
    await field(page, 1).focus();
    await page.evaluate(() => document.fonts.ready);
    mkdirSync('.local', { recursive: true });
    await page.screenshot({ path: `.local/detail-items-${width}-editor.png` });
    await save(page);
    await expect(page.locator('.task-details li')).toHaveCount(12);
    await expect(page.locator('.task-checkbox')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/detail-items-${width}-home.png`, fullPage: true });
    await page.reload();
    await edit(page, '수학 공부와 오답노트 정리');
    await expect(page.locator('.detail-input-row')).toHaveCount(12);
    await expect(field(page, 12)).toHaveValue('복습 항목 12');
  });
}
