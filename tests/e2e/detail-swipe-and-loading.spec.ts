import { expect, test } from '@playwright/test';
import { mockCloud, signIn, SHARED_SPACE } from './cloud-fixture';

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
