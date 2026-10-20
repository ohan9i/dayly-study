import { expect, test } from '@playwright/test';
import { mockCloud } from './cloud-fixture';

test('the intro requests no cloud assets; entering the planner starts only the decorative video', async ({
  page,
}) => {
  await mockCloud(page);
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('planner-clouds')) assets.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('.welcome-runway')).toBeVisible();
  await expect(page.locator('.planner-clouds')).toBeHidden();
  await expect(page.locator('.planner-clouds video, .planner-clouds img')).toHaveCount(0);
  expect(assets).toHaveLength(0);
  await page.mouse.wheel(0, 200);
  const player = page.locator('.planner-clouds video');
  await expect(player).toBeVisible();
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await player.evaluate((v: HTMLVideoElement) => ({
      muted: v.muted,
      loop: v.loop,
      controls: v.controls,
      inline: v.playsInline,
    })),
  ).toEqual({ muted: true, loop: true, controls: false, inline: true });
  await expect(page.getByRole('heading', { name: 'Prisma', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Join the lab', exact: true })).toHaveCount(0);
  await expect(page.locator('.planner-clouds')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: '수학 공부 상세 보기', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(player).toHaveCount(0);
  await page.getByRole('button', { name: '나의 하루', exact: true }).click();
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
});

test('the background pauses in hidden tabs and respects a live reduced-motion preference', async ({
  page,
}) => {
  await mockCloud(page);
  await page.goto('/#planner');
  const player = page.locator('.planner-clouds video');
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(player).toHaveCount(0);
  await expect(page.locator('.planner-clouds img')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(player).toBeVisible();
});

for (const width of [1440, 320])
  test(`cloud playback does not move or cover the planner at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockCloud(page);
    await page.goto('/#planner');
    const card = page.locator('.tasks-card');
    const player = page.locator('.planner-clouds video');
    await expect(player).toBeVisible();
    const before = await card.boundingBox();
    const beforeTime = await player.evaluate((v: HTMLVideoElement) => v.currentTime);
    await expect
      .poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(beforeTime + 0.3);
    const after = (await card.boundingBox())!;
    for (const dimension of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(after[dimension] - before![dimension])).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `.local/cloud-day-${width}.png`, fullPage: true });
    await page.locator('.planner-moment').getByRole('switch').click();
    await expect(page.locator('html')).toHaveAttribute('data-atmosphere', 'night');
    await page.screenshot({ path: `.local/cloud-night-${width}.png`, fullPage: true });
  });

test('reduced motion and failed video loading retain a static background', async ({ page }) => {
  await mockCloud(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const videos: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('planner-clouds.mp4')) videos.push(request.url());
  });
  await page.goto('/#planner');
  await expect(page.locator('.planner-clouds img')).toBeVisible();
  await expect(page.locator('.planner-clouds video')).toHaveCount(0);
  expect(videos).toHaveLength(0);
  await page.route('**/media/planner-clouds.mp4', (route) => route.abort());
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => videos.length).toBeGreaterThan(0);
  await expect(page.locator('.planner-clouds video')).toHaveCount(0);
  await expect(page.locator('.planner-clouds img')).toBeVisible();
});
