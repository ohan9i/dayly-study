import { expect, test } from '@playwright/test';
import { mockCloud, signIn } from './cloud-fixture';
test('one click opens trash confirmation; cancel preserves and confirm archives the plan', async ({
  page,
}) => {
  const cloud = await mockCloud(page);
  await page.goto('/#planner');
  await signIn(page);
  await page.getByRole('button', { name: '할 일 추가', exact: true }).click();
  await page.getByLabel('할 일', { exact: true }).fill('휴지통 검증');
  await page.getByRole('button', { name: '할 일 저장', exact: true }).click();
  await page.getByLabel('휴지통 검증 추가 작업', { exact: true }).click();
  await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('휴지통 검증');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  expect(cloud.tasks()).toHaveLength(1);
  await page.getByLabel('휴지통 검증 추가 작업', { exact: true }).click();
  await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await page.getByRole('button', { name: '휴지통으로 이동', exact: true }).click();
  await expect(page.getByRole('button', { name: '휴지통 검증 상세 보기' })).toHaveCount(0);
  expect(cloud.requests.some((request) => request.method === 'DELETE')).toBe(false);
});
