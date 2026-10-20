import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';

test('trash holds open the existing confirmation once and cancellation preserves the plan', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('길게 누르기 검증 계획');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  const task = page.getByRole('button', { name: '길게 누르기 검증 계획 상세 보기', exact: true });
  await task.click();
  const trash = page.getByRole('button', { name: '이 할 일 삭제', exact: true });
  await trash.click();
  await expect(page.getByRole('dialog')).not.toContainText('휴지통으로 보낼까요?');
  await trash.hover();
  await page.mouse.down();
  const box = (await trash.boundingBox())!;
  await page.mouse.move(box.x + box.width + 30, box.y);
  await expect(trash).toHaveAttribute('data-phase', 'idle');
  await page.mouse.up();
  await trash.click({ delay: 2150 });
  await expect(page.getByRole('dialog')).toContainText('휴지통으로 보낼까요?');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(task).toBeVisible();
  expect(cloud.tasks().some((x) => x.title === '길게 누르기 검증 계획')).toBe(true);
  await task.click();
  await trash.click({ delay: 2150 });
  await page.getByRole('button', { name: '확인', exact: true }).click();
  await expect(task).toHaveCount(0);
  expect(cloud.requests.some((r) => r.method === 'DELETE')).toBe(false);
});
