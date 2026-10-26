import { expect, test } from '@playwright/test';
import { todayKey, addDays, encodeTaskProgress, type Task } from '../../src/domain';
import { mockCloud, signIn, SHARED_SPACE } from './cloud-fixture';

test('day marks follow shared checks, undo, whole-plan completion and bare tasks', async ({
  page,
}) => {
  const make = (
    id: string,
    title: string,
    details: string[],
    checks: boolean[],
    date = todayKey(),
  ): Task => ({
    id,
    title,
    date,
    workspace_id: SHARED_SPACE,
    created_by: '10000000-0000-0000-0000-000000000002',
    details,
    detailChecks: checks.map((completed, index) => ({ id: `${id}-${index}`, completed })),
    completed: false,
  });
  const math = make(
    '30000000-0000-0000-0000-000000000030',
    '수학',
    ['순열', '조합', '확률'],
    [true, false, false],
  );
  const english = make(
    '30000000-0000-0000-0000-000000000031',
    '영어',
    ['단어', '독해'],
    [false, true],
  );
  const single = make(
    '30000000-0000-0000-0000-000000000032',
    '책 읽기',
    [],
    [],
    addDays(todayKey(), -1),
  );
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [math, english, single].map((task) => ({
      ...task,
      details: encodeTaskProgress(task, new Set()),
    })),
  });
  await page.goto('/#planner');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  const cell = page.locator('.calendar-day.is-today');
  await expect(cell).toHaveAttribute('aria-label', /계획 2개 중 0개 완료/);
  await expect(cell).toHaveClass(/is-partial-day/);
  await expect(cell.locator('.day-ring-value')).toHaveCount(0);
  cloud.externalCheck(math.id, 1, true);
  cloud.externalCheck(math.id, 2, true);
  await expect(cell).toHaveAttribute('aria-label', /계획 2개 중 1개 완료/, { timeout: 10000 });
  await expect(cell.locator('.day-ring-value')).toHaveCount(1);
  cloud.externalCheck(math.id, 2, false);
  await expect(cell).toHaveAttribute('aria-label', /계획 2개 중 0개 완료/, { timeout: 10000 });
  // The preview lists the selected day; a second tap on it opens the day.
  await expect(page.locator('.month-preview li')).toHaveCount(2);
  await expect(page.locator('.month-preview')).toContainText('수학, 진행 전');
  await expect(page.locator('.month-preview')).toContainText('영어, 진행 전');
  await cell.click();
  for (const title of ['수학', '영어']) {
    const check = page.getByRole('checkbox', { name: `${title} 완료`, exact: true });
    await check.click();
    await expect(check).toBeEnabled();
  }
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(cell).toHaveClass(/is-complete-day/);
  await expect(cell).toHaveAttribute('aria-label', /계획 2개 중 2개 완료/);
  const previous = page.locator('.calendar-day.is-partial-day');
  await expect(previous).toHaveAttribute('aria-label', /계획 1개 중 0개 완료/);
  await previous.click();
  await expect(page.locator('.calendar-day.selected-day')).toHaveAttribute(
    'aria-label',
    /계획 1개 중 0개 완료/,
  );
  await expect(page.locator('.month-preview li')).toHaveText(['책 읽기, 진행 전']);
  await page.locator('.month-preview-open').click();
  const bare = page.getByRole('checkbox', { name: '책 읽기 완료', exact: true });
  await bare.click();
  await expect(bare).toBeEnabled();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-day.is-partial-day')).toHaveCount(0);
  await expect(page.locator('.calendar-day.is-complete-day')).toHaveCount(2);
  await page.locator('.calendar-day.selected-day').click();
  await bare.click();
  await expect(bare).toBeEnabled();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-day.selected-day')).toHaveClass(/is-partial-day/);
});
