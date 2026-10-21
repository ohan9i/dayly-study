import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockCloud, signIn } from './cloud-fixture';

async function create(page: import('@playwright/test').Page, title: string, detail: string) {
  await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill(title);
  await page.getByLabel('세부 항목 1', { exact: true }).fill(detail);
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
}

test('a real spring fills the check and strikes the label; title and record actions stay separate', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await create(page, '스프링 체크 검증', '보의 휨 설계 예제 풀기');
  const child = page.getByRole('checkbox', {
    name: '스프링 체크 검증 세부 항목 1 완료',
    exact: true,
  });
  await expect(child).toHaveClass(/spring-check/);
  await child.evaluate((el) => {
    const label = el.parentElement!.querySelector('.spring-check__label')!;
    const fill = el.querySelector<HTMLElement>('.spring-check__fill')!;
    const rule = label.querySelector<HTMLElement>('.spring-check__rule')!;
    const samples = { fills: [] as string[], clips: [] as string[] };
    (window as unknown as { springSamples: typeof samples }).springSamples = samples;
    const observer = new MutationObserver(() => {
      samples.fills.push(fill.style.transform);
      samples.clips.push(rule.style.clipPath);
    });
    observer.observe(fill, { attributes: true, attributeFilter: ['style'] });
    observer.observe(rule, { attributes: true, attributeFilter: ['style'] });
    setTimeout(() => observer.disconnect(), 1800);
  });
  await child.click();
  await expect(child).toHaveAttribute('aria-checked', 'true');
  await expect(child).toBeEnabled();
  await expect
    .poll(() => child.locator('path').evaluate((el) => Number(el.style.strokeDashoffset)))
    .toBe(0);
  const samples = await page.evaluate(
    () =>
      (window as unknown as { springSamples: { fills: string[]; clips: string[] } }).springSamples,
  );
  expect(new Set(samples.fills).size).toBeGreaterThan(1);
  expect(new Set(samples.clips).size).toBeGreaterThan(1);
  await expect(page.locator('.detail-row-title')).toHaveText('보의 휨 설계 예제 풀기');
  await expect(
    page.getByRole('checkbox', { name: '스프링 체크 검증 완료', exact: true }),
  ).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: '보의 휨 설계 예제 풀기 기록 열기', exact: true }).click();
  if (await page.getByRole('button', { name: '기록 작성', exact: true }).last().isVisible())
    await page.getByRole('button', { name: '기록 작성', exact: true }).last().click();
  await page
    .locator('.detail-record-form textarea')
    .fill('체크 애니메이션 중에도 남아야 하는 풀이');
  await child.click();
  await expect(page.locator('.detail-record-form textarea')).toHaveValue(
    '체크 애니메이션 중에도 남아야 하는 풀이',
  );
  await expect(child).toBeEnabled();
  await page.getByRole('button', { name: '스프링 체크 검증 상세 보기', exact: true }).click();
  if (await page.getByRole('button', { name: '계획 편집', exact: true }).isVisible())
    await page.getByRole('button', { name: '계획 편집', exact: true }).click();
  if (await page.locator('.task-extra-actions > summary').isVisible())
    await page.locator('.task-extra-actions > summary').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('할 일', { exact: true })).toHaveValue('스프링 체크 검증');
  await page.getByLabel('세부 항목 1', { exact: true }).fill('저장 전 편집 내용');
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: '세부 항목 1 완료', exact: true })
    .click();
  await expect(page.getByLabel('세부 항목 1', { exact: true })).toHaveValue('저장 전 편집 내용');
  expect(errors).toEqual([]);
});

test('keyboard and reduced-motion checks settle immediately, including a live preference change', async ({
  page,
}) => {
  await create(page, '동작 줄이기 검증', '구조역학 문제 풀이');
  const child = page.getByRole('checkbox', {
    name: '동작 줄이기 검증 세부 항목 1 완료',
    exact: true,
  });
  await child.focus();
  await page.keyboard.press(' ');
  await expect(child).toHaveAttribute('aria-checked', 'true');
  await expect(child).toBeEnabled();
  expect(
    await child.locator('.spring-check__fill').evaluate((el) => el.getAttribute('style')),
  ).toContain('scale(1)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await child.click();
  await expect(child).toHaveAttribute('aria-checked', 'false');
  await expect(child).toBeEnabled();
  expect(
    await child.locator('.spring-check__fill').evaluate((el) => el.getAttribute('style')),
  ).toContain('scale(0)');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await child.click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(child).toBeEnabled();
  await expect
    .poll(() => child.locator('path').evaluate((el) => Number(el.style.strokeDashoffset)))
    .toBe(0);
  expect(
    await child.locator('.spring-check__box').evaluate((el) => el.getAttribute('style')),
  ).toContain('scale(1)');
});

test('320px wrapped labels retain one copy of text and align the strike across lines', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const title = '철근콘크리트 보와 기둥의 구조 설계를 정리하고 연습문제를 복습하기';
  const detail =
    '주어진 설계 조건으로 압축응력블록 깊이와 인장철근량을 계산하고 풀이 과정 검토하기';
  await create(page, title, detail);
  await page.getByRole('checkbox', { name: `${title} 완료`, exact: true }).click();
  await expect(page.getByRole('checkbox', { name: `${title} 완료`, exact: true })).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.locator('.detail-row-title .spring-check__rule').evaluate((el) =>
        el.style.clipPath
          .match(/[\d.]+/g)
          ?.map(Number)
          .every((value) => value === 0),
      ),
    )
    .toBe(true);
  await expect(page.locator('.task-title')).toHaveText(title);
  await expect(page.locator('.detail-row-title')).toHaveText(detail);
  const sizes = await page.locator('.detail-row-title .spring-check__label').evaluate((el) => {
    const word = el.querySelector('.spring-check__word')!.getBoundingClientRect();
    const rule = el.querySelector('.spring-check__rule')!.getBoundingClientRect();
    return {
      word: { width: word.width, height: word.height },
      rule: { width: rule.width, height: rule.height },
    };
  });
  expect(sizes.word.height).toBeGreaterThan(40);
  expect(sizes.word.width).toBeCloseTo(sizes.rule.width, 1);
  expect(sizes.word.height).toBeCloseTo(sizes.rule.height, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  mkdirSync('.local/spring', { recursive: true });
  await expect(page.locator('.toast.visible')).toHaveCount(0, { timeout: 6000 });
  await page.screenshot({ path: '.local/spring/mobile-checked.png', fullPage: true });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: `${title} 완료`, exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('.task-title')).toHaveText(title);
});
