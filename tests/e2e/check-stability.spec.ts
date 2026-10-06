import { expect, test, type Locator, type Page } from '@playwright/test';
import { todayKey } from '../../src/domain';
import { mockCloud, OWN_SPACE, signIn } from './cloud-fixture';

async function stableCheck(page: Page, checkbox: Locator) {
  await checkbox.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate(() => {
    const card = document.querySelector('.tasks-card')!;
    const state = {
      top: card.getBoundingClientRect().top,
      scroll: scrollY,
      maxMove: 0,
      maxScroll: 0,
      loading: false,
      running: true,
    };
    (window as unknown as { checkStability: typeof state }).checkStability = state;
    function sample() {
      state.maxMove = Math.max(
        state.maxMove,
        Math.abs(card.getBoundingClientRect().top - state.top),
      );
      state.maxScroll = Math.max(state.maxScroll, Math.abs(scrollY - state.scroll));
      state.loading ||= Boolean(document.querySelector('.loading-note'));
      if (state.running) requestAnimationFrame(sample);
    }
    sample();
  });
  await checkbox.click();
  await expect(checkbox).toBeEnabled();
  const measured = await page.evaluate(() => {
    const state = (
      window as unknown as {
        checkStability: { running: boolean; maxMove: number; maxScroll: number; loading: boolean };
      }
    ).checkStability;
    state.running = false;
    return state;
  });
  expect(measured.loading).toBe(false);
  expect(measured.maxMove).toBeLessThanOrEqual(1);
  expect(measured.maxScroll).toBeLessThanOrEqual(1);
}

for (const width of [1440, 390]) {
  test(`checking keeps cards and scroll stable without reloading data at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const cloud = await mockCloud(page, {
      nativeDetails: false,
      tasks: [
        {
          id: 'legacy-single',
          title: '기존 단일 할 일',
          date: todayKey(),
          details: '',
          created_by: '10000000-0000-0000-0000-000000000001',
          workspace_id: OWN_SPACE,
        },
      ],
    });
    await page.goto('/');
    await signIn(page);
    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page.getByLabel('할 일', { exact: true }).fill('안정적인 체크');
    await page.getByLabel('세부 항목 1', { exact: true }).fill('확률 문제');
    await page.getByRole('button', { name: '한 줄 추가', exact: true }).click();
    await page.getByLabel('세부 항목 2', { exact: true }).fill('오답 정리');
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.route('https://*.supabase.co/rest/v1/**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fallback();
    });
    const reads = () =>
      cloud.requests.filter(
        (request) =>
          request.method === 'GET' &&
          request.path.startsWith('/rest/') &&
          !request.path.endsWith('/workspace_activity'),
      ).length;
    const before = reads();
    const child = page.getByRole('checkbox', {
      name: '안정적인 체크 세부 항목 1 완료',
      exact: true,
    });
    const parent = page.getByRole('checkbox', { name: '안정적인 체크 완료', exact: true });
    await stableCheck(page, child);
    await expect(child).toHaveAttribute('aria-checked', 'true');
    await stableCheck(page, child);
    await expect(child).toHaveAttribute('aria-checked', 'false');
    await stableCheck(page, parent);
    await expect(parent).toHaveAttribute('aria-checked', 'true');
    await stableCheck(
      page,
      page.getByRole('checkbox', { name: '기존 단일 할 일 완료', exact: true }),
    );
    expect(reads()).toBe(before);

    await page.getByRole('button', { name: '안정적인 체크 상세 보기', exact: true }).click();
    await page.getByLabel('세부 항목 1', { exact: true }).fill('저장 전 수정 내용');
    const detailCheck = page
      .getByRole('dialog')
      .getByRole('checkbox', { name: '세부 항목 1 완료', exact: true });
    await detailCheck.click();
    await expect(detailCheck).toBeEnabled();
    await expect(page.getByLabel('세부 항목 1', { exact: true })).toHaveValue('저장 전 수정 내용');
    expect(reads()).toBe(before);
    await page.getByRole('button', { name: '닫기', exact: true }).click();
    await page.reload();
    await expect(child).toHaveAttribute('aria-checked', 'false');
    await expect(parent).toHaveAttribute('aria-checked', 'false');
    await expect(
      page.getByRole('checkbox', { name: '기존 단일 할 일 완료', exact: true }),
    ).toHaveAttribute('aria-checked', 'true');
  });
}
