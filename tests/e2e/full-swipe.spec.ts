import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockCloud, signIn, OWN_SPACE, SHARED_SPACE } from './cloud-fixture';
import { normalizeTask, todayKey } from '../../src/domain';

async function setup(page: Page, foreign = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const cloud = await mockCloud(page, {
    approved: true,
    tasks: [
      {
        id: 'swipe-plan',
        workspace_id: foreign ? SHARED_SPACE : OWN_SPACE,
        created_by: foreign
          ? '10000000-0000-0000-0000-000000000002'
          : '10000000-0000-0000-0000-000000000001',
        title: '구조역학 학습',
        date: todayKey(),
        details: '전단력 선도\n휨모멘트 계산',
      },
    ],
  });
  await page.goto('/#planner');
  await signIn(page);
  if (foreign) await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
  await expect(page.locator('.task-title')).toBeVisible();
  return cloud;
}
async function freeze(page: Page) {
  const now = Date.now();
  await page.clock.install({ time: new Date(now) });
  await page.clock.pauseAt(new Date(now + 1000));
}
const plan = (page: Page) => page.locator('.task-copy > .swipe-action');
const detail = (page: Page) => page.locator('.task-details .swipe-action').first();
async function drag(
  page: Page,
  row: Locator,
  direction: 'add' | 'delete',
  ratio = 0.95,
  release = true,
) {
  await row.scrollIntoViewIfNeeded();
  const box = (await row.boundingBox())!;
  const x = direction === 'add' ? box.x + 52 : box.x + box.width - 60;
  await page.mouse.move(x, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    x + box.width * ratio * (direction === 'add' ? 1 : -1),
    box.y + box.height / 2,
    { steps: 8 },
  );
  if (release) await page.mouse.up();
}

for (const target of ['plan', 'detail'] as const) {
  test(`${target}: full swipe waits 1000ms, then deletes exactly once without a confirmation`, async ({
    page,
  }) => {
    const cloud = await setup(page);
    const before = normalizeTask(cloud.tasks()[0]).detailChecks!;
    await freeze(page);
    const row = target === 'plan' ? plan(page) : detail(page);
    await drag(page, row, 'delete');
    await expect(row).toHaveAttribute('data-phase', 'waiting');
    await page.clock.runFor(999);
    expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/archive_task')).toHaveLength(0);
    expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
    await page.clock.runFor(2);
    if (target === 'plan') {
      await expect(page.locator('.task-title')).toHaveCount(0);
      expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/archive_task')).toHaveLength(1);
    } else {
      await expect(page.locator('.task-details > li')).toHaveCount(1);
      const after = normalizeTask(cloud.tasks()[0]);
      expect(after.details).toEqual(['휨모멘트 계산']);
      expect(after.detailChecks![0].id).toBe(before[1].id);
      expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/archive_task')).toHaveLength(0);
      expect(
        cloud.requests.filter(
          (r) => r.method === 'DELETE' && /task_notes|task_attachments/.test(r.path),
        ),
      ).toHaveLength(0);
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.runFor(2000);
    expect(
      cloud.requests.filter((r) =>
        target === 'plan'
          ? r.path === '/rest/v1/rpc/archive_task'
          : r.path === '/rest/v1/rpc/update_task_content',
      ),
    ).toHaveLength(1);
  });

  test(`${target}: full right swipe opens an immediately editable addition`, async ({ page }) => {
    await setup(page);
    await freeze(page);
    const row = target === 'plan' ? plan(page) : detail(page);
    await drag(page, row, 'add');
    await expect(row).toHaveAttribute('data-phase', 'waiting');
    await page.clock.runFor(999);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.runFor(2);
    await expect(page.getByLabel('할 일', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '계획 편집', exact: true })).toHaveCount(0);
    if (target === 'plan') {
      await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('');
      await page.getByLabel('할 일', { exact: true }).fill('새 계획');
    } else {
      const inputs = page.locator('.detail-items-editor input[type=text]');
      await expect(inputs).toHaveCount(3);
      await expect(inputs.nth(1)).toHaveValue('');
      await expect(inputs.nth(1)).toBeFocused();
      await inputs.nth(1).fill('추가한 계산');
    }
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (target === 'detail') await expect(page.locator('.task-details > li')).toHaveCount(3);
    else await expect(page.locator('.task-title')).toHaveCount(2);
  });
}

test('short drags, cancellation, Escape, navigation and workspace changes abort pending swipes', async ({
  page,
}) => {
  const cloud = await setup(page);
  await freeze(page);
  await drag(page, detail(page), 'delete', 0.4);
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  await page.clock.runFor(1500);
  expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
  for (const cancel of ['button', 'escape', 'outside', 'date', 'workspace']) {
    await drag(page, detail(page), 'delete');
    await expect(detail(page)).toHaveAttribute('data-phase', 'waiting');
    if (cancel === 'button')
      await detail(page)
        .getByRole('button', { name: /밀기 취소/ })
        .click();
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'outside') await page.locator('.page-heading h1').click();
    if (cancel === 'date')
      await page.getByRole('button', { name: '이전 날짜', exact: true }).click();
    if (cancel === 'workspace') await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
    await page.clock.runFor(1500);
    expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
    if (cancel === 'date')
      await page.getByRole('button', { name: '다음 날짜', exact: true }).click();
  }
  expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/update_task_content')).toHaveLength(
    0,
  );
});

test('holding at the far edge for one second adds once and returning before the deadline cancels', async ({
  page,
}) => {
  await setup(page);
  await freeze(page);
  await drag(page, plan(page), 'add', 1.01, false);
  await expect(plan(page)).toHaveAttribute('data-phase', 'waiting');
  await page.clock.runFor(999);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.runFor(2);
  await expect(page.getByLabel('할 일', { exact: true })).toBeVisible();
  await page.mouse.up();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.clock.runFor(1000);
  await drag(page, plan(page), 'add', 1.01, false);
  await expect(plan(page)).toHaveAttribute('data-phase', 'waiting');
  const box = (await plan(page).boundingBox())!;
  await page.mouse.move(box.x + 65, box.y + box.height / 2);
  await page.mouse.up();
  await page.clock.runFor(1500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('phone swipe and keyboard actions share the same one second delay; vertical drags and checkbox clicks stay independent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await freeze(page);
  const box = (await detail(page).boundingBox())!;
  await page.mouse.move(box.x + 55, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(1200);
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('checkbox', { name: '구조역학 학습 세부 항목 1 완료', exact: true }).click();
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  await drag(page, detail(page), 'add');
  await expect(detail(page)).toHaveAttribute('data-phase', 'waiting');
  await page.keyboard.press('Escape');
  await plan(page).focus();
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(1001);
  await expect(page.getByLabel('할 일', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('the opening planner contains blank paper and no text or mock rows', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/');
  const paper = page.locator('.book-paper');
  await expect(paper).toHaveText('');
  await expect(paper.locator('*')).toHaveCount(0);
  await expect(page.locator('.book-page-marks')).toHaveCount(0);
  await expect(page.locator('.book-front')).toBeVisible();
  await page.mouse.wheel(0, 100);
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'opening');
  await expect(paper).toHaveText('');
  await expect(page.locator('.entry-flow')).toHaveAttribute('data-phase', 'entered', {
    timeout: 5000,
  });
});

test('touch swipes at phone width complete without opening records or the plan by accident', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const box = (await detail(page).boundingBox())!;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const start = box.x + 18,
    end = Math.min(388, start + box.width * 0.96),
    y = box.y + box.height / 2;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start, y }],
  });
  for (let i = 1; i <= 8; i++)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start + ((end - start) * i) / 8, y }],
    });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(detail(page)).toHaveAttribute('data-phase', 'waiting');
  await expect(page.locator('.task-details .detail-checkbox').first()).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.locator('.detail-record-panel')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.detail-items-editor input[type=text]')).toHaveCount(3);
  await expect(page.locator('details')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/[•·]/);
});

test('a failed swipe keeps the detail and retry applies the deletion once', async ({ page }) => {
  const cloud = await setup(page);
  await freeze(page);
  await page.route(
    'https://*.supabase.co/rest/v1/rpc/update_task_content',
    (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: '잠시 저장할 수 없어요.' }),
      }),
    { times: 1 },
  );
  await drag(page, detail(page), 'delete');
  await page.clock.runFor(1001);
  await expect(page.locator('.action-error')).toBeVisible();
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
  await page.locator('.action-error').getByRole('button', { name: /다시/ }).click();
  await expect(page.locator('.task-details > li')).toHaveCount(1);
  expect(normalizeTask(cloud.tasks()[0]).details).toEqual(['휨모멘트 계산']);
});

test('the regular motion path finishes its full-width animation before the one second countdown', async ({
  page,
}) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await freeze(page);
  await drag(page, plan(page), 'add');
  await expect(plan(page)).toHaveAttribute('data-phase', 'waiting');
  await page.clock.runFor(999);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.runFor(2);
  await expect(page.getByLabel('할 일', { exact: true })).toBeVisible();
});

test('approved participants can swipe to add and archive another author plan while detail editing stays protected', async ({
  page,
}) => {
  const cloud = await setup(page, true);
  await freeze(page);
  await drag(page, detail(page), 'delete');
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  await page.clock.runFor(1001);
  expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/update_task_content')).toHaveLength(
    0,
  );
  await drag(page, plan(page), 'add');
  await page.clock.runFor(1001);
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await drag(page, plan(page), 'delete');
  await page.clock.runFor(1001);
  await expect(page.locator('.task-title')).toHaveCount(0);
  expect(cloud.requests.filter((r) => r.path === '/rest/v1/rpc/archive_task')).toHaveLength(1);
});
