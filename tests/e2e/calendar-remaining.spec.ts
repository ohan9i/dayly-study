import { expect, test } from '@playwright/test';
import { todayKey, addDays, encodeTaskProgress, type Task } from '../../src/domain';
import { mockCloud, signIn, SHARED_SPACE } from './cloud-fixture';

test('remaining counts follow shared checks, undo, whole-plan completion and bare tasks', async ({
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
  await page.goto('/');
  await signIn(page);
  await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await page.getByRole('button', { name: '달력', exact: true }).click();
  const cell = page.locator('.calendar-day.is-today');
  await expect(cell.locator('.calendar-remaining')).toHaveText('남은 3');
  await expect(cell).toHaveAttribute('aria-label', /40%, 남은 계획 3개/);
  cloud.externalCheck(math.id, 1, true);
  await expect(cell.locator('.calendar-remaining')).toHaveText('남은 2', { timeout: 10000 });
  cloud.externalCheck(math.id, 1, false);
  await expect(cell.locator('.calendar-remaining')).toHaveText('남은 3', { timeout: 10000 });
  await cell.click();
  for (const title of ['수학', '영어']) {
    const check = page.getByRole('checkbox', { name: `${title} 완료`, exact: true });
    await check.click();
    await expect(check).toBeEnabled();
  }
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(cell.locator('.calendar-remaining')).toHaveCount(0);
  await expect(cell).toHaveAttribute('aria-label', /100%, 남은 계획 0개/);
  const previous = page.getByRole('button', {
    name: /세부 항목 1개 중 0개 완료, 0%, 남은 계획 1개/,
  });
  await expect(previous.locator('.calendar-remaining')).toHaveText('남은 1');
  await previous.click();
  const bare = page.getByRole('checkbox', { name: '책 읽기 완료', exact: true });
  await bare.click();
  await expect(bare).toBeEnabled();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(page.locator('.calendar-remaining')).toHaveCount(0);
  await page.locator('.calendar-day.selected-day').click();
  await bare.click();
  await expect(bare).toBeEnabled();
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await expect(previous.locator('.calendar-remaining')).toHaveText('남은 1');
});
