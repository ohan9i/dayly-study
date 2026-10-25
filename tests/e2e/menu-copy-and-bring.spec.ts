import { expect, test } from '@playwright/test';
import { addDays, normalizeTask, todayKey } from '../../src/domain';
import { mockCloud, signIn, OWN_SPACE, SHARED_SPACE } from './cloud-fixture';

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

test('plans from another day are brought to the viewed day with their progress', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const today = todayKey(),
    yesterday = addDays(today, -1);
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'left',
        workspace_id: OWN_SPACE,
        created_by: owner,
        title: '남은 계획',
        date: yesterday,
        details: '첫 항목\n둘째 항목',
      },
      {
        id: 'done',
        workspace_id: OWN_SPACE,
        created_by: owner,
        title: '끝낸 계획',
        date: yesterday,
        details: '',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  // Finish one item of the plan that will move, and the whole other plan.
  await page.getByRole('button', { name: '이전 날짜', exact: true }).click();
  await page.getByRole('checkbox', { name: '남은 계획 세부 항목 1 완료', exact: true }).click();
  await page.getByRole('checkbox', { name: '끝낸 계획 완료', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '끝낸 계획 완료', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '오늘', exact: true }).click();
  await page.getByRole('button', { name: '다른 날짜에서 계획 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  // The latest day with something left opens, its unfinished plans already picked.
  await expect(dialog.getByLabel('가져올 날짜', { exact: true })).toHaveValue(yesterday);
  await expect(dialog.getByRole('checkbox', { name: /남은 계획/ })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: /끝낸 계획/ })).not.toBeChecked();
  await dialog
    .getByRole('button', {
      name: `1개를 ${Number(today.slice(5, 7))}월 ${Number(today.slice(8))}일로 가져오기`,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.task-title')).toHaveText('남은 계획');
  const moved = normalizeTask(cloud.tasks().find((task) => task.id === 'left')!);
  expect(moved.date).toBe(today);
  expect(moved.detailChecks!.map((check) => check.completed)).toEqual([true, false]);
  expect(cloud.tasks().find((task) => task.id === 'done')!.date).toBe(yesterday);
  expect(cloud.tasks()).toHaveLength(2);
});

test('plans written by someone else cannot be brought by a participant', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const today = todayKey();
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'theirs',
        workspace_id: SHARED_SPACE,
        created_by: '10000000-0000-0000-0000-000000000002',
        title: '다른 사람 계획',
        date: addDays(today, -2),
        details: '',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '다른 날짜에서 계획 가져오기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('작성자만 옮길 수 있어요');
  await expect(dialog.getByRole('checkbox', { name: /다른 사람 계획/ })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '가져올 계획을 골라 주세요' })).toBeDisabled();
  expect(cloud.tasks()[0].date).toBe(addDays(today, -2));
});
