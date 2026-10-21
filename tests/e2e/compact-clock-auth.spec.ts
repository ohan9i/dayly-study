import { expect, test } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

test('the main timer digits are the only editor and Enter starts the selected time', async ({
  page,
}) => {
  await mockCloud(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#planner');
  const card = page.getByRole('region', { name: '타이머와 스톱워치' });
  await expect(page.getByText('현재 시각, 서울', { exact: true })).toHaveCount(0);
  await expect(card.locator('.focus-clock-settings, .focus-duration')).toHaveCount(0);
  const fields = card.locator('.focus-clock-display input');
  await expect(fields).toHaveCount(3);
  await card.getByLabel('타이머 분', { exact: true }).fill('0');
  await card.getByLabel('타이머 초', { exact: true }).fill('20');
  await expect(card.getByRole('timer')).toHaveText('00:00:20');
  expect((await card.boundingBox())!.height).toBeLessThan(350);
  await card.getByLabel('타이머 초', { exact: true }).press('Enter');
  await expect(card.getByRole('button', { name: '일시정지', exact: true })).toBeVisible();
  await expect(fields).toHaveCount(0);
  await expect(card.locator('.circle-progress-value')).toBeVisible();
  await card.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(card.locator('.focus-clock-display input')).toHaveCount(3);
});

test('countdown and stopwatch roll in opposite directions and respect reduced motion', async ({
  page,
}) => {
  await mockCloud(page);
  await page.addInitScript(() => {
    const events: string[] = [];
    (window as unknown as { numberAnimations: string[] }).numberAnimations = events;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.classList.contains('countdown-number-current'))
        events.push(String((frames as Keyframe[])[0].transform));
      return Reflect.apply(animate, this, [frames, options]);
    };
  });
  await page.clock.install({ time: new Date('2026-10-21T03:00:00Z') });
  await page.goto('/#planner');
  await page.clock.pauseAt(new Date('2026-10-21T03:01:00Z'));
  const card = page.getByRole('region', { name: '타이머와 스톱워치' });
  const animations = () =>
    page.evaluate(() => (window as unknown as { numberAnimations: string[] }).numberAnimations);
  await card.getByLabel('타이머 분', { exact: true }).fill('0');
  await card.getByLabel('타이머 초', { exact: true }).fill('10');
  await card.getByRole('button', { name: '시작', exact: true }).click();
  await page.clock.fastForward(1000);
  await expect(card.getByRole('timer')).toHaveText('00:00:09');
  expect(await animations()).toContain('translateY(-100%)');
  await card.getByRole('switch', { name: '스톱워치 모드' }).click();
  await card.getByRole('button', { name: '시작', exact: true }).click();
  await page.clock.fastForward(1000);
  await expect(card.getByRole('timer')).toHaveText('00:00:01');
  expect(await animations()).toContain('translateY(100%)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const count = (await animations()).length;
  await page.clock.fastForward(2000);
  await expect(card.getByRole('timer')).toHaveText('00:00:03');
  expect((await animations()).length).toBe(count);
});

for (const width of [1440, 390, 320]) {
  test(`compact cards and the login card fit both themes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCloud(page);
    await page.goto('/#planner');
    await page.screenshot({
      path: `.local/compact-clock-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '내 계정', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.auth-card .ui-card-title')).toHaveText('로그인');
    await expect(dialog.getByLabel('이메일', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('비밀번호', { exact: true })).toBeVisible();
    await expect(
      dialog.locator('.ui-card-footer').getByRole('button', { name: '나중에', exact: true }),
    ).toBeVisible();
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(Math.min(420, width));
    await page.screenshot({
      path: `.local/login-card-morning-${width}.png`,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: '나중에', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .locator('.planner-moment')
      .getByRole('switch', { name: '밤 공부', exact: true })
      .click();
    await page.getByRole('button', { name: '내 계정', exact: true }).click();
    await page.screenshot({ path: `.local/login-card-night-${width}.png`, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
