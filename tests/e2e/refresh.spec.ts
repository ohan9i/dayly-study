import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockCloud, PNG, signIn } from './cloud-fixture';

async function keepTypingAfterReturning(page: Page, field: Locator, draft: string) {
  await field.fill(draft);
  await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => {
    el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    // A visible tab also makes the real Supabase SDK re-confirm SIGNED_IN.
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
  });
  // Cross two of the former 30-second refresh intervals while composing Korean text.
  await page.clock.runFor(61000);
  await expect(field).toBeEnabled();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(draft);
  expect(
    await field.evaluate((el: HTMLInputElement | HTMLTextAreaElement) => el.selectionStart),
  ).toBe(draft.length);
  await field.dispatchEvent('compositionend', { data: '' });
  await page.keyboard.insertText(' 계속 작성');
  await expect(field).toHaveValue(draft + ' 계속 작성');
}

for (const width of [1536, 390]) {
  test(`typing keeps focus, Korean drafts and queued files after timers and tab return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cloud = await mockCloud(page);
    await page.clock.install();
    await page.goto('./');
    await signIn(page);
    const reads = () =>
      cloud.requests.filter((r) => r.method === 'GET' && r.path.startsWith('/rest/')).length;

    await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
    await page.getByLabel('할 일', { exact: true }).fill('자동 갱신 없이 공부 계획 작성');
    await page.getByLabel('파일 첨부', { exact: true }).setInputFiles({
      name: '작성 중 참고 사진.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.locator('.file-queue li')).toHaveCount(1);
    const initialReads = reads();
    await keepTypingAfterReturning(
      page,
      page.getByRole('textbox', { name: '메모', exact: true }),
      '구조역학 문제를 풀면서 작성 중인 메모',
    );
    expect(reads()).toBe(initialReads);
    await expect(page.locator('.file-queue li')).toContainText('작성 중 참고 사진.png');
    await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: '자동 갱신 없이 공부 계획 작성 상세 보기' }).click();
    await expect(page.getByRole('textbox', { name: '메모', exact: true })).toHaveValue(
      '구조역학 문제를 풀면서 작성 중인 메모 계속 작성',
    );

    await page.getByText('수행 내용 남기기', { exact: true }).click();
    await page.getByLabel('수행 파일 첨부', { exact: true }).setInputFiles({
      name: '작성 중 풀이 사진.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(page.locator('.note-composer .file-queue li')).toHaveCount(1);
    const noteReads = reads();
    await keepTypingAfterReturning(
      page,
      page.getByLabel('수행 내용', { exact: true }),
      '보의 전단력과 휨모멘트 계산 과정을 정리했어요',
    );
    expect(reads()).toBe(noteReads);
    await expect(page.locator('.note-composer')).toHaveAttribute('open', '');
    await expect(page.locator('.note-composer .file-queue li')).toContainText(
      '작성 중 풀이 사진.png',
    );
    await page.getByRole('button', { name: '수행 내용 저장', exact: true }).click();
    await expect(page.locator('.task-note')).toContainText(
      '보의 전단력과 휨모멘트 계산 과정을 정리했어요 계속 작성',
    );
    await expect(page.locator('.note-composer')).not.toHaveAttribute('open', '');
    await page.getByRole('button', { name: '닫기', exact: true }).click();

    await page.getByRole('button', { name: '설정', exact: true }).click();
    const settingsReads = reads();
    await keepTypingAfterReturning(
      page,
      page.getByLabel('내 공간 이름', { exact: true }),
      '차분하게 공부하는 나의 공간',
    );
    expect(reads()).toBe(settingsReads);
    await page.getByRole('button', { name: '공간 이름 저장', exact: true }).click();
    await expect(page.getByText('이름을 저장했어요.', { exact: true })).toBeVisible();

    const beforeManualRefresh = reads();
    await page.getByRole('button', { name: '공유 기록 새로고침', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '공유 기록 새로고침', exact: true }),
    ).toBeEnabled();
    expect(reads()).toBeGreaterThan(beforeManualRefresh);
    await expect(page.getByLabel('내 공간 이름', { exact: true })).toHaveValue(
      '차분하게 공부하는 나의 공간 계속 작성',
    );
    expect(errors).toEqual([]);
  });
}
