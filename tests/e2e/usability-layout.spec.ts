import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { mockCloud, signIn, OWN_SPACE } from './cloud-fixture';
import { todayKey, encodeTaskProgress, type Task } from '../../src/domain';

for (const [width, height] of [
  [1366, 768],
  [1920, 1080],
  [360, 800],
]) {
  test(`home, calendar and detail layout at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const task: Task = {
      id: '30000000-0000-0000-0000-000000000040',
      workspace_id: OWN_SPACE,
      created_by: '10000000-0000-0000-0000-000000000001',
      title: '수학 공부',
      date: todayKey(),
      details: ['순열 문제 풀기', '조합 문제 풀기', '확률 문제 풀기'],
      detailChecks: [
        { id: 'a', completed: true },
        { id: 'b', completed: false },
        { id: 'c', completed: false },
      ],
    };
    await mockCloud(page, { tasks: [{ ...task, details: encodeTaskProgress(task, new Set()) }] });
    await page.goto('/');
    await signIn(page);
    await page.evaluate(() => document.fonts.ready);
    mkdirSync('.local/usability', { recursive: true });
    const stage = process.env.DAYLY_CAPTURE_STAGE || 'after';
    const capture = async (view: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: `.local/usability/${stage}-${width}-${view}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    };
    await expect(page.getByRole('button', { name: '수학 공부 상세 보기' })).toBeVisible();
    if (stage !== 'before') {
      await expect(page.locator('.live-clock')).toBeVisible();
      if (width <= 700) {
        expect(
          await page
            .locator('.task-details .detail-checkbox')
            .first()
            .evaluate((el) => el.getBoundingClientRect().height),
        ).toBe(44);
      }
    }
    await expect(page.locator('.toast.visible')).toHaveCount(0, { timeout: 6000 });
    writeFileSync(
      `.local/usability/${stage}-${width}-metrics.json`,
      JSON.stringify(
        await page.evaluate(() => {
          const selectors = [
            '.view-home h1',
            '.tasks-card',
            '.live-clock',
            '.moment',
            '.task-details .detail-checkbox',
            '.detail-row-title',
          ];
          return selectors.map((selector) => {
            const el = document.querySelector(selector)!;
            const style = getComputedStyle(el),
              rect = el.getBoundingClientRect();
            return {
              selector,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              display: style.display,
              fontSize: style.fontSize,
              color: style.color,
            };
          });
        }),
        null,
        2,
      ),
    );
    await capture('home');
    if (stage !== 'before' && width <= 700) {
      await page.getByRole('button', { name: '순열 문제 풀기 기록 열기', exact: true }).click();
      const record = page.locator('.detail-record-form textarea');
      await expect(record).toBeVisible();
      const input = await record.evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        fontSize: parseFloat(getComputedStyle(el).fontSize),
      }));
      expect(input.width).toBeGreaterThan(200);
      expect(input.fontSize).toBe(16);
      await record.fill('문제 풀이 과정과 다음에 확인할 내용을 기록합니다.');
      await capture('record');
      await page.getByRole('button', { name: '순열 문제 풀기 기록 접기', exact: true }).click();
    }
    if (stage !== 'before') {
      // Measure the actual composite backdrop after hiding only the glyphs.
      // Token-vs-white checks miss contrast problems on translucent scenery.
      const targets = await page.evaluate(() => {
        return [
          '.task-title',
          '.detail-row-title',
          '.save-note',
          '.moment .live-clock',
          '.moment > p',
          '.moment blockquote',
        ].map((selector) => {
          const el = document.querySelector<HTMLElement>(selector)!;
          const rect = el.getBoundingClientRect(),
            style = getComputedStyle(el);
          const data = {
            selector,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            color: style.color,
            minimum: parseFloat(style.fontSize) >= 24 ? 3 : 4.5,
            inlineColor: el.style.color,
            inlineTextShadow: el.style.textShadow,
            inlineDecorationColor: el.style.textDecorationColor,
          };
          el.style.color = 'transparent';
          el.style.textShadow = 'none';
          el.style.textDecorationColor = 'transparent';
          return data;
        });
      });
      const pixels = await sharp(await page.screenshot({ fullPage: true, animations: 'disabled' }))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      await page.evaluate(
        (targets) =>
          targets.forEach((target) => {
            const el = document.querySelector<HTMLElement>(target.selector)!;
            el.style.color = target.inlineColor;
            el.style.textShadow = target.inlineTextShadow;
            el.style.textDecorationColor = target.inlineDecorationColor;
          }),
        targets,
      );
      const luminance = (rgb: number[]) =>
        rgb
          .map((v) => v / 255)
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      const contrasts = targets.map((target) => {
        const foreground = luminance(target.color.match(/\d+/g)!.slice(0, 3).map(Number));
        const samples: number[] = [];
        for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
          for (const fy of [0.25, 0.5, 0.75]) {
            const index =
              (Math.floor(target.y + target.height * fy) * pixels.info.width +
                Math.floor(target.x + target.width * fx)) *
              3;
            const background = luminance([...pixels.data.subarray(index, index + 3)]);
            samples.push(
              (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
            );
          }
        return {
          selector: target.selector,
          contrast: Math.min(...samples),
          minimum: target.minimum,
        };
      });
      writeFileSync(
        `.local/usability/${stage}-${width}-contrast.json`,
        JSON.stringify(contrasts, null, 2),
      );
      for (const target of contrasts)
        expect(target.contrast, target.selector).toBeGreaterThanOrEqual(target.minimum);
    }
    await page.getByRole('button', { name: '달력', exact: true }).click();
    await expect(page.locator('.calendar-day')).toHaveCount(42);
    if (stage !== 'before') {
      const boxes = await page.locator('.calendar-day.is-today').evaluate((el) => {
        const day = el.querySelector('.day-number')!.getBoundingClientRect();
        const remaining = el.querySelector('.calendar-remaining')!.getBoundingClientRect();
        const track = el.querySelector('.calendar-progress-track')!.getBoundingClientRect();
        return {
          day: { top: day.top, bottom: day.bottom, right: day.right },
          remaining: { top: remaining.top, bottom: remaining.bottom, left: remaining.left },
          track: { top: track.top },
        };
      });
      expect(boxes.remaining.bottom).toBeLessThanOrEqual(boxes.track.top);
      expect(
        width <= 700
          ? boxes.remaining.top >= boxes.day.bottom
          : boxes.remaining.left >= boxes.day.right,
      ).toBe(true);
    }
    await capture('calendar');
    await page.locator('.calendar-day.is-today').click();
    await page.getByRole('button', { name: '수학 공부 상세 보기' }).click();
    expect(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await capture('detail');
    if (stage !== 'before') {
      await page.getByRole('button', { name: '이 계획 복제', exact: true }).click();
      await expect(page.getByLabel('복제할 날짜')).toHaveValue(todayKey());
      expect(
        await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await capture('duplicate');
      if (width <= 700) {
        // This approximates viewport shrinkage; it is not a physical OS keyboard.
        await page.setViewportSize({ width, height: 420 });
        await page.getByLabel('복제할 날짜').focus();
        const submit = page.getByRole('button', { name: '계획 복제', exact: true });
        await submit.scrollIntoViewIfNeeded();
        const box = await submit.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(420);
        expect(
          await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        await page.setViewportSize({ width, height });
      }
      await page.getByRole('button', { name: '계획 복제', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await expect(page.getByRole('button', { name: '수학 공부 상세 보기' })).toHaveCount(2);
    }
  });
}
