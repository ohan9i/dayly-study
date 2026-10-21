import { expect, test, type Page } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

const card = (page: Page) => page.getByRole('region', { name: '타이머와 스톱워치' });
const display = (page: Page) => card(page).getByRole('timer');
const mode = (page: Page) => card(page).getByRole('switch', { name: '스톱워치 모드' });
async function setup(page: Page) {
  await mockCloud(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2026-10-21T03:00:00Z') });
  await page.goto('/#planner');
  await expect(card(page)).toBeVisible();
  await page.clock.pauseAt(new Date('2026-10-21T03:01:00Z'));
}
async function duration(page: Page, minutes: string, seconds: string) {
  await card(page).getByLabel('타이머 분', { exact: true }).fill(minutes);
  await card(page).getByLabel('타이머 초', { exact: true }).fill(seconds);
}

test('custom timer counts down, pauses, resumes, finishes and resets to the chosen duration', async ({
  page,
}) => {
  await setup(page);
  await duration(page, '1', '5');
  await expect(display(page)).toHaveText('00:01:05');
  await card(page).getByRole('button', { name: '시작', exact: true }).click();
  await expect(card(page).getByLabel('타이머 분', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(5000);
  await expect(display(page)).toHaveText('00:01:00');
  await card(page).getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(card(page).getByLabel('타이머 분', { exact: true })).toHaveValue('01');
  await expect(card(page).getByLabel('타이머 초', { exact: true })).toHaveValue('00');
  await page.clock.fastForward(10_000);
  await expect(display(page)).toHaveText('00:01:00');
  await card(page).getByRole('button', { name: '계속', exact: true }).click();
  await page.clock.fastForward(60_000);
  await expect(display(page)).toHaveText('00:00:00');
  await expect(card(page).getByRole('status')).toHaveText('설정한 시간이 끝났어요.');
  await card(page).getByRole('button', { name: '다시 시작', exact: true }).click();
  await expect(display(page)).toHaveText('00:01:05');
  await page.clock.fastForward(2000);
  await card(page).getByRole('button', { name: '타이머 초기화', exact: true }).click();
  await expect(display(page)).toHaveText('00:01:05');
  await expect(card(page).getByLabel('타이머 분', { exact: true })).toBeEnabled();
});

test('both modes keep independent time across switching, navigation and reload', async ({
  page,
}) => {
  await setup(page);
  await duration(page, '0', '30');
  await card(page).getByRole('button', { name: '시작', exact: true }).click();
  await page.clock.fastForward(5000);
  await mode(page).click();
  await expect(display(page)).toHaveText('00:00:00');
  await card(page).getByRole('button', { name: '시작', exact: true }).click();
  await page.clock.fastForward(10_000);
  await expect(display(page)).toHaveText('00:00:10');
  await mode(page).click();
  await expect(display(page)).toHaveText('00:00:15');
  await card(page).getByRole('button', { name: '일시정지', exact: true }).click();
  await mode(page).click();
  await page.getByRole('button', { name: '학습 흐름', exact: true }).click();
  await page.clock.fastForward(5000);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(display(page)).toHaveText('00:00:15');
  await page.reload();
  await expect(mode(page)).toBeChecked();
  await expect(display(page)).toHaveText('00:00:15');
  await page.clock.fastForward(5000);
  await expect(display(page)).toHaveText('00:00:20');
  await card(page).getByRole('button', { name: '일시정지', exact: true }).click();
  await page.clock.fastForward(5000);
  await expect(display(page)).toHaveText('00:00:20');
  await card(page).getByRole('button', { name: '스톱워치 초기화', exact: true }).click();
  await expect(display(page)).toHaveText('00:00:00');
  await mode(page).click();
  await expect(display(page)).toHaveText('00:00:15');
});

test('returning from a suspended tab uses the deadline instead of counting timer callbacks', async ({
  page,
}) => {
  await setup(page);
  await duration(page, '0', '20');
  await card(page).getByRole('button', { name: '시작', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 30_000));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(display(page)).toHaveText('00:00:00');
  await expect(card(page).getByRole('status')).toHaveText('설정한 시간이 끝났어요.');
});

test('input validation and keyboard switching work without requiring an account', async ({
  page,
}) => {
  await setup(page);
  await duration(page, '0', '0');
  await expect(card(page).getByRole('button', { name: '시작', exact: true })).toBeDisabled();
  await card(page).getByLabel('타이머 초', { exact: true }).fill('60');
  await expect(card(page).getByLabel('타이머 초', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(card(page).getByRole('status')).toContainText('0~59');
  await card(page).getByLabel('타이머 초', { exact: true }).fill('3');
  await expect(card(page).getByRole('button', { name: '시작', exact: true })).toBeEnabled();
  await mode(page).focus();
  await page.keyboard.press(' ');
  await expect(mode(page)).toBeChecked();
  await expect(display(page)).toHaveAttribute('aria-label', '스톱워치 경과 시간');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

for (const width of [1440, 1000, 390, 320]) {
  test(`clock and focus cards stack with equal widths in both themes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCloud(page);
    await page.goto('/#planner');
    const clock = page.locator('.planner-moment');
    const clockBox = (await clock.boundingBox())!;
    const focusBox = (await card(page).boundingBox())!;
    expect(Math.abs(clockBox.x - focusBox.x)).toBeLessThan(1);
    expect(Math.abs(clockBox.width - focusBox.width)).toBeLessThan(1);
    expect(focusBox.y).toBeGreaterThanOrEqual(clockBox.y + clockBox.height + 12);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/focus-clock-morning-${width}.png`, fullPage: true });
    await clock.getByRole('switch', { name: '밤 공부', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
    await mode(page).click();
    await expect(mode(page)).toBeChecked();
    await page.screenshot({ path: `.local/focus-clock-night-${width}.png`, fullPage: true });
  });
}
