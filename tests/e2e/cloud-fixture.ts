import { expect, type Page } from '@playwright/test';
import type { Task } from '../../src/domain';

// Exercises the real Supabase browser SDK without creating users or sending email.
// Production database permissions are tested separately against the actual SQL.
export const TEST_EMAIL = 'student@example.com';
export const TEST_PASSWORD = 'study-pass-2026';
export async function mockCloud(page: Page) {
  const owner = '10000000-0000-0000-0000-000000000001';
  const space = '20000000-0000-0000-0000-000000000001';
  const user = {
    id: owner,
    aud: 'authenticated',
    role: 'authenticated',
    email: TEST_EMAIL,
    email_confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    'eyJhbGciOiJIUzI1NiJ9',
    Buffer.from(
      JSON.stringify({
        sub: owner,
        exp: expires,
        email: TEST_EMAIL,
        role: 'authenticated',
        aud: 'authenticated',
      }),
    ).toString('base64url'),
    'test-signature',
  ].join('.');
  const session = {
    access_token: token,
    refresh_token: 'test-refresh-token',
    expires_in: 3600,
    expires_at: expires,
    token_type: 'bearer',
    user,
  };
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  let tasks: Task[] = [],
    completed: string[] = [],
    authenticated = false;
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const body = request.postData() ? request.postDataJSON() : {};
    requests.push({ path: url.pathname, method: request.method(), body });
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/auth/v1/token') {
      if (body.password !== TEST_PASSWORD && url.searchParams.get('grant_type') !== 'refresh_token')
        return send({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400);
      authenticated = true;
      return send(session);
    }
    if (url.pathname === '/auth/v1/logout') {
      authenticated = false;
      return send({});
    }
    if (url.pathname === '/auth/v1/signup') return send({ ...user, email_confirmed_at: null });
    if (url.pathname === '/auth/v1/recover') return send({});
    if (url.pathname === '/auth/v1/user') {
      authenticated = true;
      return send(user);
    }
    if (!authenticated) return send({ message: 'Not authenticated', code: '42501' }, 401);
    const table = url.pathname.split('/').pop();
    if (table === 'workspaces')
      return send([{ id: space, name: '나의 공부 공간', owner_id: owner }]);
    if (table === 'workspace_members') return send([]);
    if (table === 'tasks') {
      if (request.method() === 'GET') return send(tasks);
      if (request.method() === 'POST') {
        tasks.push(body as Task);
        return send({});
      }
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      const task = tasks.find((task) => task.id === id);
      if (request.method() === 'PATCH' && task) Object.assign(task, body);
      if (request.method() === 'DELETE') {
        tasks = tasks.filter((task) => task.id !== id);
        completed = completed.filter((value) => value !== id);
      }
      return send(request.headers().accept?.includes('object') ? { id } : [{ id }]);
    }
    if (table === 'task_completions') {
      if (request.method() === 'GET') return send(completed.map((task_id) => ({ task_id })));
      const id =
        request.method() === 'POST'
          ? String(body.task_id)
          : url.searchParams.get('task_id')?.replace(/^eq\./, '');
      if (request.method() === 'POST') completed.push(id!);
      else completed = completed.filter((value) => value !== id);
      return send(request.headers().accept?.includes('object') ? { task_id: id } : {});
    }
    return send({ message: `Unexpected endpoint ${url.pathname}` }, 404);
  });
  return {
    requests,
    recoveryHash: `#access_token=${token}&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer&type=recovery`,
  };
}
export async function signIn(page: Page) {
  if (!(await page.getByRole('dialog').isVisible()))
    await page.getByRole('button', { name: '내 계정', exact: true }).click();
  await page.getByLabel('이메일', { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel('비밀번호', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: '비밀번호로 로그인', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('여백이 있는 하루', { exact: true })).toBeVisible();
}
