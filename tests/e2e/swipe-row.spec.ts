import { expect, test, type Page, type Locator } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';

async function setup(page: Page) {
  const cloud = await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('밀기 검증 계획');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('풀이 기록');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  return cloud;
}
const row = (page: Page) =>
  page
    .locator('.swipe-row')
    .filter({ has: page.getByRole('button', { name: '밀기 검증 계획 상세 보기' }) });
async function swipe(page: Page, target: Locator, dx: number, dy = 0) {
  const box = (await target.locator('.task-title').boundingBox())!;
  const startX = box.x + box.width / 2,
    startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  await page.mouse.up();
}

test('left swipe reveals a held delete, right swipe opens the add form without changing the source', async ({
  page,
}) => {
  const cloud = await setup(page);
  const source = structuredClone(cloud.tasks()[0]);
  await swipe(page, row(page), -130);
  await expect(row(page)).toHaveAttribute('data-open', 'delete');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const trash = page.getByRole('button', { name: '밀기 검증 계획 휴지통으로', exact: true });
  await trash.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await trash.click({ delay: 2150 });
  await expect(page.getByRole('dialog')).toContainText('휴지통으로 보낼까요?');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(row(page)).toHaveAttribute('data-open', 'closed');
  await swipe(page, row(page), 130);
  await expect(row(page)).toHaveAttribute('data-open', 'add');
  await page.getByRole('button', { name: '밀기 검증 계획 옆에 계획 추가', exact: true }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('');
  expect(cloud.tasks()).toEqual([source]);
  await page.getByLabel('할 일', { exact: true }).fill('추가된 계획');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '추가된 계획 상세 보기' })).toBeVisible();
  expect(cloud.tasks()).toHaveLength(2);
});

test('vertical movement does not reveal actions; completion, records and keyboard menus remain usable', async ({
  page,
}) => {
  await setup(page);
  await swipe(page, row(page), 15, 75);
  await expect(row(page)).toHaveAttribute('data-open', 'closed');
  await page.getByRole('checkbox', { name: '밀기 검증 계획 완료', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: '밀기 검증 계획 완료', exact: true }),
  ).toBeChecked();
  await page.getByRole('button', { name: '풀이 기록 기록 열기', exact: true }).click();
  await page.locator('.detail-record-form textarea').fill('보존할 초안');
  const menu = page.getByRole('button', { name: '밀기 검증 계획 삭제 메뉴', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(row(page)).toHaveAttribute('data-open', 'delete');
  await page.keyboard.press('Escape');
  await expect(row(page)).toHaveAttribute('data-open', 'closed');
  await page.getByRole('button', { name: '달력', exact: true }).click();
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(page.locator('.detail-record-form textarea')).toHaveValue('보존할 초안');
  await expect(page.locator('.paper-transition, .paper-crumple')).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((r) => /PaperTransition|PaperCrumple/.test(r.name)),
    ),
  ).toBe(false);
});

test('mobile touch swipe and cancellation preserve the row at 320px', async ({ page, context }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await row(page).scrollIntoViewIfNeeded();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const bounds = (await row(page).locator('.task-title').boundingBox())!;
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - step * 12, y }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(row(page)).toHaveAttribute('data-open', 'delete');
  await page.screenshot({ path: '.local/swipe-mobile-delete.png', fullPage: true });
  await page.getByRole('button', { name: '계획 행 메뉴 닫기' }).click();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 45, y }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(row(page)).toHaveAttribute('data-open', 'closed');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 5; step++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + step * 12, y }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(row(page)).toHaveAttribute('data-open', 'add');
  await page.screenshot({ path: '.local/swipe-mobile-add.png', fullPage: true });
  await page.getByRole('button', { name: '밀기 검증 계획 옆에 계획 추가', exact: true }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/swipe-mobile.png', fullPage: true });
});

test('visitors can read plans but cannot expose write actions', async ({ page }) => {
  await mockCloud(page);
  await page.goto('/#planner');
  await expect(page.locator('.swipe-row__menus')).toHaveCount(0);
  await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('수학 공부');
});
