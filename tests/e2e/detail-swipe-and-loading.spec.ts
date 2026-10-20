import { expect, test, type Locator, type Page } from '@playwright/test';
import { normalizeTask } from '../../src/domain';
import { mockCloud, signIn, SHARED_SPACE } from './cloud-fixture';

async function drag(page: Page, target: Locator, delta: number, touch: boolean) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.locator('.detail-row-title').boundingBox())!;
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  if (touch) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (delta * step) / 8, y }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + delta, y, { steps: 10 });
    await page.mouse.up();
  }
}

for (const width of [1440, 320])
  test(`detail swipes add and remove only the chosen item at ${width}px without moving its parent`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cloud = await mockCloud(page);
    await page.goto('/#planner');
    await signIn(page);
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page.getByLabel('할 일', { exact: true }).fill('세부 밀기 검증');
    await page.getByLabel('세부 항목 1', { exact: true }).fill('보 설계');
    await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
    await page.getByLabel('세부 항목 2', { exact: true }).fill('기둥 설계');
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await page
      .getByRole('checkbox', { name: '세부 밀기 검증 세부 항목 2 완료', exact: true })
      .click();
    await expect(
      page.getByRole('checkbox', { name: '세부 밀기 검증 세부 항목 2 완료', exact: true }),
    ).toBeEnabled();
    const before = normalizeTask(cloud.tasks()[0]);
    const detail = page.getByRole('group', {
      name: '세부 밀기 검증 세부 항목 1 작업 메뉴',
      exact: true,
    });
    const parent = page.getByRole('group', { name: '세부 밀기 검증 작업 메뉴', exact: true });
    await expect(page.locator('.swipe-row__menus')).toHaveCount(0);
    await drag(page, detail, 90, width === 320);
    await expect(detail).toHaveAttribute('data-open', 'add');
    await expect(parent).toHaveAttribute('data-open', 'closed');
    await detail
      .getByRole('button', { name: '보 설계 다음에 세부 항목 추가', exact: true })
      .click();
    await expect(page.getByLabel('세부 항목 2', { exact: true })).toBeFocused();
    await expect(page.getByLabel('세부 항목 2', { exact: true })).toHaveValue('');
    await page.getByLabel('세부 항목 2', { exact: true }).fill('접합부 설계');
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const added = normalizeTask(cloud.tasks()[0]);
    expect(added.details).toEqual(['보 설계', '접합부 설계', '기둥 설계']);
    expect(added.detailChecks![2]).toEqual(before.detailChecks![1]);
    await drag(page, detail, -90, width === 320);
    await expect(detail).toHaveAttribute('data-open', 'delete');
    await expect(parent).toHaveAttribute('data-open', 'closed');
    const trash = detail.getByRole('button', { name: '보 설계 세부 항목 삭제', exact: true });
    await trash.click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await trash.click({ delay: 2150 });
    await expect(page.getByRole('dialog')).toContainText('세부 항목을 삭제할까요?');
    await page.getByRole('button', { name: '확인', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const removed = normalizeTask(cloud.tasks()[0]);
    expect(removed.details).toEqual(['접합부 설계', '기둥 설계']);
    expect(removed.detailChecks![1]).toEqual(before.detailChecks![1]);
    expect(cloud.requests.some((r) => r.method === 'DELETE')).toBe(false);
    await page.screenshot({ path: `.local/detail-swipe-${width}.png`, fullPage: true });
  });

for (const width of [1440, 320])
  test(`refresh and workspace changes keep the planner stationary at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockCloud(page, { approved: true });
    await page.goto('/#planner');
    await signIn(page);
    await expect(page.locator('.loading-note')).toHaveCount(0);
    let release: (() => void) | undefined;
    await page.route('https://*.supabase.co/rest/v1/workspaces*', async (route) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fallback();
    });
    for (const mode of ['refresh', 'workspace']) {
      const top = await page
        .locator('.tasks-card')
        .evaluate((el) => el.getBoundingClientRect().top);
      if (mode === 'refresh')
        await page.getByRole('button', { name: '공유 기록 새로고침', exact: true }).click();
      else await page.getByLabel('사용 공간 선택').selectOption(SHARED_SPACE);
      const status = page.locator('.loading-note');
      await expect(status).toBeVisible();
      await expect(status).toHaveCSS('position', 'fixed');
      await expect(status).toHaveCSS('animation-name', 'none');
      expect(
        await page.locator('.tasks-card').evaluate((el) => el.getBoundingClientRect().top),
      ).toBe(top);
      await expect(page.locator('.topbar .spin')).toHaveCount(0);
      release!();
      await expect(
        page.getByRole('button', { name: '공유 기록 새로고침', exact: true }),
      ).toBeEnabled();
      await expect(status).toHaveCount(0);
      expect(
        await page.locator('.tasks-card').evaluate((el) => el.getBoundingClientRect().top),
      ).toBe(top);
    }
  });
