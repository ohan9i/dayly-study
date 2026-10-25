import { expect, test } from '@playwright/test';
import { addDays, emptySnapshot, normalizeTask, todayKey } from '../../src/domain';
import { mockCloud, signIn, OWN_SPACE } from './cloud-fixture';

const owner = '10000000-0000-0000-0000-000000000001';

test('the plan menu copies to a picked date without opening the plan', async ({ page }) => {
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'menu-plan',
        workspace_id: OWN_SPACE,
        created_by: owner,
        title: '구조역학 학습',
        date: todayKey(),
        details: '전단력 선도\n휨모멘트 계산',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByLabel('구조역학 학습 추가 작업', { exact: true }).click();
  await page.getByRole('button', { name: '복제', exact: true }).click();
  // No dialog: the menu itself becomes the date picker, defaulting to the next day.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const picker = page.getByLabel('복제할 날짜', { exact: true });
  await expect(picker).toHaveValue(addDays(todayKey(), 1));
  await expect(picker).toBeFocused();
  const target = addDays(todayKey(), 3);
  await picker.fill(target);
  await page
    .getByRole('button', {
      name: `${Number(target.slice(5, 7))}월 ${Number(target.slice(8))}일에 복제`,
      exact: true,
    })
    .click();
  await expect(page.locator('.plan-copy-picker')).toHaveCount(0);
  expect(cloud.tasks()).toHaveLength(2);
  const copy = normalizeTask(cloud.tasks()[1]);
  expect(copy).toMatchObject({ date: target, title: '구조역학 학습' });
  expect(copy.details).toEqual(['전단력 선도', '휨모멘트 계산']);
  // The view follows the copy, like copying from the plan detail.
  await expect(page.getByLabel('조회 날짜')).toHaveValue(target);
  await expect(page.locator('.task-title')).toHaveCount(1);
  await expect(page.locator('.task-title')).toHaveText('구조역학 학습');
});

test('the copy picker closes with Escape and cancel without writing', async ({ page }) => {
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'menu-plan',
        workspace_id: OWN_SPACE,
        created_by: owner,
        title: '구조역학 학습',
        date: todayKey(),
        details: '',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  const trigger = page.getByLabel('구조역학 학습 추가 작업', { exact: true });
  await trigger.click();
  await page.getByRole('button', { name: '복제', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.plan-copy-picker')).toHaveCount(0);
  await trigger.click();
  await page.getByRole('button', { name: '복제', exact: true }).click();
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('.plan-copy-picker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '복제', exact: true })).toBeVisible();
  expect(cloud.requests.some((r) => r.path === '/rest/v1/rpc/duplicate_task')).toBe(false);
  expect(cloud.tasks()).toHaveLength(1);
});

test('a backup file adds its plans to the current space once', async ({ page }) => {
  const day = todayKey();
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'kept',
        workspace_id: OWN_SPACE,
        created_by: owner,
        title: '이미 있는 계획',
        date: day,
        details: '',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  const backup = {
    ...emptySnapshot(),
    tasks: [
      { id: 'b1', title: '이미 있는 계획', date: day, details: [], created_by: 'x' },
      {
        id: 'b2',
        title: '가져온 계획',
        date: day,
        details: ['첫 항목', '둘째 항목'],
        detailChecks: [
          { id: 'c1', completed: true },
          { id: 'c2', completed: false },
        ],
        created_by: 'x',
      },
    ],
    completedTaskIds: [],
  };
  const file = {
    name: 'dayly-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  };
  await page.getByRole('button', { name: '설정', exact: true }).first().click();
  await page.getByLabel('가져올 백업 파일', { exact: true }).setInputFiles(file);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('계획 1개를 새로 추가합니다');
  await expect(dialog).toContainText('이미 있는 1개는 건너뛰어요');
  await dialog.getByRole('button', { name: '1개 가져오기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(cloud.tasks()).toHaveLength(2);
  const added = normalizeTask(cloud.tasks()[1]);
  expect(added).toMatchObject({ title: '가져온 계획', date: day, workspace_id: OWN_SPACE });
  expect(added.id).not.toBe('b2');
  expect(added.details).toEqual(['첫 항목', '둘째 항목']);
  expect(added.detailChecks!.some((check) => check.completed)).toBe(false);
  // The same file again adds nothing.
  await page.getByLabel('가져올 백업 파일', { exact: true }).setInputFiles(file);
  // Toasts queue, so this one follows the import's own message.
  await expect(page.getByText('백업의 계획 2개가 이미', { exact: false })).toBeVisible({
    timeout: 10_000,
  });
  expect(cloud.tasks()).toHaveLength(2);
});

test('a file that is not a Dayly backup is refused', async ({ page }) => {
  const cloud = await mockCloud(page, { approved: true });
  await page.goto('/#planner');
  await signIn(page);
  const before = cloud.tasks().length;
  await page.getByRole('button', { name: '설정', exact: true }).first().click();
  await page.getByLabel('가져올 백업 파일', { exact: true }).setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hello":1}'),
  });
  await expect(page.getByRole('alert')).toContainText('백업 JSON 파일인지 확인해 주세요');
  expect(cloud.tasks()).toHaveLength(before);
});
