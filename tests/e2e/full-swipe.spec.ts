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
  ratio = 0.51,
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
  test(`${target}: half swipe opens the one-line quick add without waiting or releasing`, async ({
    page,
  }) => {
    const cloud = await setup(page);
    await freeze(page);
    const row = target === 'plan' ? plan(page) : detail(page);
    await drag(page, row, 'add', 0.51, false);
    const field = page.locator('.quick-add input');
    await expect(field).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    // Only the one line, not the whole plan editor.
    await expect(page.locator('.detail-items-editor')).toHaveCount(0);
    await page.clock.runFor(100);
    await expect(field).toBeFocused();
    await field.fill(target === 'detail' ? '새 계산' : '새 계획');
    await field.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.clock.runFor(3000);
    if (target === 'detail') {
      // The new item lands right below the swiped row.
      await expect(page.locator('.task-details > li')).toHaveCount(3);
      expect(normalizeTask(cloud.tasks()[0]).details).toEqual([
        '전단력 선도',
        '새 계산',
        '휨모멘트 계산',
      ]);
    } else {
      await expect(page.locator('.task-title')).toHaveCount(2);
      await expect(page.locator('.task-title').nth(1)).toHaveText('새 계획');
    }
  });

  test(`${target}: halfway deletion needs a continuous 2000ms hold and executes once`, async ({
    page,
  }) => {
    const cloud = await setup(page);
    const before = normalizeTask(cloud.tasks()[0]).detailChecks!;
    await freeze(page);
    const row = target === 'plan' ? plan(page) : detail(page);
    await drag(page, row, 'delete', 0.51, false);
    await expect(row).toHaveAttribute('data-phase', 'waiting');
    const translation = await row.evaluate((el) => {
      const content = el.querySelector('.swipe-action__content')!;
      return Math.abs(new DOMMatrix(getComputedStyle(content).transform).m41) / el.clientWidth;
    });
    expect(translation).toBeCloseTo(0.5, 2);
    await page.clock.runFor(1999);
    expect(
      cloud.requests.filter((r) => /rpc\/(archive_task|update_task_content)$/.test(r.path)),
    ).toHaveLength(0);
    await page.clock.runFor(1);
    if (target === 'plan') await expect(page.locator('.task-title')).toHaveCount(0);
    else {
      await expect(page.locator('.task-details > li')).toHaveCount(1);
      expect(normalizeTask(cloud.tasks()[0]).detailChecks![0].id).toBe(before[1].id);
    }
    await page.mouse.up();
    await page.clock.runFor(3000);
    expect(
      cloud.requests.filter((r) => /rpc\/(archive_task|update_task_content)$/.test(r.path)),
    ).toHaveLength(1);
    expect(cloud.requests.some((r) => r.method === 'DELETE')).toBe(false);
  });
}

test('short swipes do nothing; release, returning, Escape and navigation cancel the deletion hold', async ({
  page,
}) => {
  const cloud = await setup(page);
  await freeze(page);
  for (const direction of ['add', 'delete'] as const) {
    await drag(page, detail(page), direction, 0.45);
    await page.clock.runFor(2500);
    await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  for (const cancel of ['release', 'return', 'escape', 'date', 'workspace']) {
    await drag(page, detail(page), 'delete', 0.51, false);
    await page.clock.runFor(1500);
    if (cancel === 'release') await page.mouse.up();
    if (cancel === 'return') {
      const box = (await detail(page).boundingBox())!;
      await page.mouse.move(box.x + box.width - 65, box.y + box.height / 2);
    }
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'date')
      await page
        .getByRole('button', { name: '이전 날짜', exact: true })
        .evaluate((el: HTMLButtonElement) => el.click());
    if (cancel === 'workspace') await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
    await page.mouse.up();
    await page.clock.runFor(2500);
    expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
    if (cancel === 'date')
      await page.getByRole('button', { name: '다음 날짜', exact: true }).click();
  }
  expect(
    cloud.requests.filter((r) => /rpc\/(archive_task|update_task_content)$/.test(r.path)),
  ).toHaveLength(0);
});

test('returning and rearming restarts the full two second hold', async ({ page }) => {
  const cloud = await setup(page);
  await freeze(page);
  await drag(page, detail(page), 'delete', 0.51, false);
  await page.clock.runFor(1500);
  const box = (await detail(page).boundingBox())!;
  const start = box.x + box.width - 60,
    y = box.y + box.height / 2;
  await page.mouse.move(start - box.width * 0.4, y);
  await expect(detail(page)).toHaveAttribute('data-phase', 'dragging');
  await page.mouse.move(start - box.width * 0.51, y);
  await page.clock.runFor(1999);
  expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
  await page.clock.runFor(1);
  await expect(page.locator('.task-details > li')).toHaveCount(1);
  await page.mouse.up();
});

test('keyboard adds immediately and deletion requires holding Left for two seconds', async ({
  page,
}) => {
  const cloud = await setup(page);
  await freeze(page);
  await plan(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.quick-add input')).toHaveValue('');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await detail(page).focus();
  await page.keyboard.down('ArrowLeft');
  await page.clock.runFor(1500);
  await page.keyboard.up('ArrowLeft');
  await page.clock.runFor(2500);
  expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
  await detail(page).focus();
  await page.keyboard.down('ArrowLeft');
  await page.clock.runFor(2000);
  await expect(page.locator('.task-details > li')).toHaveCount(1);
  await page.keyboard.up('ArrowLeft');
});

for (const direction of ['add', 'delete'] as const) {
  test(`phone touch: halfway ${direction}, checkboxes and records stay independent`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cloud = await setup(page);
    await freeze(page);
    const box = (await detail(page).boundingBox())!;
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    const start = direction === 'add' ? box.x + 18 : box.x + box.width - 18;
    const end = start + box.width * 0.51 * (direction === 'add' ? 1 : -1),
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
    if (direction === 'delete') {
      await expect(detail(page)).toHaveAttribute('data-phase', 'waiting');
      await page.clock.runFor(1999);
      expect(normalizeTask(cloud.tasks()[0]).details).toHaveLength(2);
      await page.clock.runFor(1);
      await expect(page.locator('.task-details > li')).toHaveCount(1);
    } else await expect(page.locator('.quick-add input')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.locator('.detail-record-panel')).toHaveCount(0);
    expect(normalizeTask(cloud.tasks()[0]).detailChecks!.some((check) => check.completed)).toBe(
      false,
    );
  });
}

test('vertical gestures and ordinary checkbox clicks stay separate', async ({ page }) => {
  await setup(page);
  await freeze(page);
  const box = (await detail(page).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 65, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.clock.runFor(2500);
  await expect(detail(page)).toHaveAttribute('data-phase', 'idle');
  await page.getByRole('checkbox', { name: '구조역학 학습 세부 항목 1 완료', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '구조역학 학습 세부 항목 1 완료', exact: true }),
  ).toBeChecked();
});
