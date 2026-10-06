import { expect, type Page } from '@playwright/test';
import {
  todayKey,
  normalizeTask,
  encodeTaskProgress,
  isTaskComplete,
  type TaskRecord,
  type TaskNote,
  type TaskAttachment,
  type Workspace,
} from '../../src/domain';

// Real browser SDK with a local API fixture. Actual SQL/RLS has separate PostgreSQL tests.
export const TEST_EMAIL = 'student@example.com';
export const TEST_PASSWORD = 'study-pass-2026';
export const OWN_SPACE = '20000000-0000-0000-0000-000000000001';
export const SHARED_SPACE = '20000000-0000-0000-0000-000000000002';
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB0QAAAAASUVORK5CYII=',
  'base64',
);
function samplePdf() {
  const stream = 'BT /F1 18 Tf 50 760 Td (Study task attachment) Tj ET';
  const entries = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>',
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
  ];
  let value = '%PDF-1.4\n';
  const offsets = [0];
  entries.forEach((entry, i) => {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${entry}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<</Size 6 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value);
}
export const PDF = samplePdf();
export async function mockCloud(
  page: Page,
  options: {
    approved?: boolean;
    startWithoutOwnSpace?: boolean;
    tasks?: TaskRecord[];
    nativeDetails?: boolean;
    emptyActivity?: boolean;
  } = {},
) {
  const owner = '10000000-0000-0000-0000-000000000001',
    other = '10000000-0000-0000-0000-000000000002';
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
  let spaces: Workspace[] = options.approved
    ? [{ id: SHARED_SPACE, name: '함께 공부하는 공간', owner_id: other }]
    : [];
  if (!options.startWithoutOwnSpace)
    spaces.push({ id: OWN_SPACE, name: '나의 공부 공간', owner_id: owner });
  let tasks: TaskRecord[] =
    options.tasks ||
    (options.approved
      ? [
          {
            id: '30000000-0000-0000-0000-000000000001',
            workspace_id: SHARED_SPACE,
            created_by: other,
            title: '공유한 구조역학 문제',
            subject: '구조역학',
            date: todayKey(),
            time: '',
            details: '함께 풀어 주세요.',
          },
        ]
      : []);
  let notes: TaskNote[] = [],
    files: TaskAttachment[] = [],
    completed: string[] = [],
    authenticated = false,
    failNextUpload = false;
  const objects = new Map<string, { buffer: Buffer; type: string }>();
  const activity = new Map<
    string,
    { workspace_id: string; revision: number; request_id: string | null }
  >();
  const bump = (space: string, requestId: string | null = null) =>
    activity.set(space, {
      workspace_id: space,
      revision: (activity.get(space)?.revision || 0) + 1,
      request_id: requestId,
    });
  const writeProgress = (record: TaskRecord, task: ReturnType<typeof normalizeTask>) => {
    task.completed = isTaskComplete(task, new Set(completed));
    Object.assign(record, {
      details: encodeTaskProgress(task, new Set(completed)),
      detail_items: task.details,
      revision: (record.revision || 0) + 1,
    });
    completed = completed.filter((id) => id !== task.id);
    if (task.completed) completed.push(task.id);
  };
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method();
    const contentType = request.headers()['content-type'] || '';
    const body =
      request.postData() && contentType.includes('application/json') ? request.postDataJSON() : {};
    requests.push({ path: url.pathname, method, body });
    const send = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const returned = (data: Record<string, unknown>) =>
      send(request.headers().accept?.includes('object') ? data : [data]);
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
    if (url.pathname.endsWith('/rpc/ensure_personal_workspace')) {
      if (!spaces.some((s) => s.owner_id === owner))
        spaces.push({ id: OWN_SPACE, name: '나의 공부 공간', owner_id: owner });
      return send(OWN_SPACE);
    }
    if (
      url.pathname.endsWith('/rpc/set_task_completion') ||
      url.pathname.endsWith('/rpc/update_task_content') ||
      url.pathname.endsWith('/rpc/move_task')
    ) {
      const record = tasks.find(
        (task) => task.id === body.p_task_id && task.workspace_id === body.p_workspace_id,
      );
      if (!record || !spaces.some((space) => space.id === body.p_workspace_id))
        return send({ message: 'Task was moved or deleted', code: '42501' }, 403);
      const task = normalizeTask(record, completed.includes(record.id));
      if (url.pathname.endsWith('/set_task_completion')) {
        const done = Boolean(body.p_completed),
          stamp = new Date().toISOString();
        if (!body.p_detail_id) task.completed = done;
        task.detailChecks = task.detailChecks?.map((check) =>
          !body.p_detail_id || check.id === body.p_detail_id
            ? {
                ...check,
                completed: done,
                completedBy: done ? owner : null,
                completedAt: done ? stamp : null,
              }
            : check,
        );
        writeProgress(record, task);
      } else {
        const source = spaces.find((space) => space.id === body.p_workspace_id)!;
        if (record.created_by !== owner && source.owner_id !== owner)
          return send(
            { message: 'Only the author or workspace owner can edit or move', code: '42501' },
            403,
          );
        if (url.pathname.endsWith('/update_task_content')) {
          const items = body.p_items as { id: string; text: string }[];
          task.title = String(body.p_title);
          task.date = String(body.p_date);
          task.details = items.map((item) => item.text);
          task.detailChecks = items.map(
            (item) =>
              task.detailChecks?.find((check) => check.id === item.id) || {
                id: item.id,
                completed: false,
              },
          );
          Object.assign(record, { title: task.title, date: task.date });
          writeProgress(record, task);
        } else {
          if (!spaces.some((space) => space.id === body.p_target_workspace_id))
            return send({ message: 'Workspace access denied' }, 403);
          record.workspace_id = String(body.p_target_workspace_id);
          for (const row of [...notes, ...files])
            if (row.task_id === record.id) row.workspace_id = record.workspace_id;
          bump(record.workspace_id, String(body.p_request_id));
        }
      }
      bump(String(body.p_workspace_id), String(body.p_request_id));
      return send(record);
    }
    if (url.pathname.startsWith('/storage/v1/')) {
      const prefix = '/storage/v1/object/';
      if (method === 'DELETE') {
        const paths = (body.prefixes || []) as string[];
        paths.forEach((path) => objects.delete(path));
        return send(paths.map((name) => ({ name })));
      }
      if (url.pathname.startsWith(`${prefix}sign/`) && method === 'POST')
        return send({
          signedURL: `/object/sign/${url.pathname.slice((prefix + 'sign/').length)}?token=test`,
        });
      const relative = url.pathname.slice(prefix.length).replace(/^(sign|authenticated)\//, '');
      const path = decodeURIComponent(relative.replace(/^task-files\//, ''));
      if (method === 'POST') {
        if (failNextUpload) {
          failNextUpload = false;
          return send(
            { statusCode: '500', error: 'Upload failed', message: 'Simulated network error' },
            500,
          );
        }
        const metadata = files.find((f) => f.object_path === path);
        if (!metadata) return send({ message: 'Missing metadata' }, 400);
        const raw = request.postDataBuffer()!;
        const signature =
          metadata.mime_type === 'application/pdf'
            ? Buffer.from('%PDF-')
            : Buffer.from([137, 80, 78, 71]);
        const start = raw.indexOf(signature),
          end = raw.indexOf(Buffer.from('\r\n--'), Math.max(0, start));
        objects.set(path, {
          buffer: start >= 0 ? raw.subarray(start, end > start ? end : undefined) : raw,
          type: metadata.mime_type,
        });
        return send({ Key: `task-files/${path}`, Id: metadata.id });
      }
      const object = objects.get(path);
      return object
        ? route.fulfill({ status: 200, contentType: object.type, body: object.buffer })
        : send({ message: 'Object not found' }, 404);
    }
    const table = url.pathname.split('/').pop(),
      workspace = url.searchParams.get('workspace_id')?.replace(/^eq\./, '');
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const ids =
      url.searchParams
        .get('id')
        ?.replace(/^in\(|\)$/g, '')
        .split(',') || [];
    if (table === 'workspace_activity') {
      if (!spaces.some((space) => space.id === workspace)) return send(null);
      if (options.emptyActivity && !activity.has(workspace!)) return send(null);
      return send(
        activity.get(workspace!) || { workspace_id: workspace, revision: 0, request_id: null },
      );
    }
    if (table === 'workspaces') {
      if (method === 'PATCH') {
        Object.assign(
          spaces.find((space) => space.id === id)!,
          body,
        );
        return returned({ id });
      }
      return send(id ? spaces.filter((space) => space.id === id) : spaces);
    }
    if (table === 'workspace_members') return send([]);
    if (table === 'tasks') {
      if (method === 'GET')
        return send(
          tasks
            .filter((t) => !workspace || t.workspace_id === workspace)
            .map((t) =>
              options.nativeDetails === false ? t : { ...t, detail_items: t.detail_items ?? null },
            ),
        );
      if (options.nativeDetails === false && Object.hasOwn(body, 'detail_items'))
        return send(
          {
            code: 'PGRST204',
            message: "Could not find the 'detail_items' column of 'tasks' in the schema cache",
          },
          400,
        );
      if (method === 'POST') {
        tasks.push(body as TaskRecord);
        bump(String(body.workspace_id));
        return send({});
      }
      const task = tasks.find((t) => t.id === id);
      if (method === 'PATCH' && task) Object.assign(task, body);
      if (method === 'DELETE') {
        tasks = tasks.filter((t) => t.id !== id);
        completed = completed.filter((value) => value !== id);
        notes = notes.filter((n) => n.task_id !== id);
        files = files.filter((f) => f.task_id !== id);
      }
      return returned({ id });
    }
    if (table === 'task_notes') {
      if (method === 'GET')
        return send(notes.filter((n) => !workspace || n.workspace_id === workspace));
      if (method === 'POST') {
        notes.push({
          ...body,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as TaskNote);
        return send({});
      }
      if (method === 'PATCH')
        Object.assign(
          notes.find((n) => n.id === id)!,
          body,
          { updated_at: new Date().toISOString() },
        );
      if (method === 'DELETE') {
        notes = notes.filter((n) => n.id !== id);
        files = files.filter((f) => f.note_id !== id);
      }
      return returned({ id });
    }
    if (table === 'task_attachments') {
      if (method === 'GET')
        return send(
          files.filter(
            (f) =>
              (!workspace || f.workspace_id === workspace) &&
              (!url.searchParams.has('task_id') ||
                f.task_id === url.searchParams.get('task_id')?.replace(/^eq\./, '')) &&
              (!url.searchParams.has('note_id') ||
                f.note_id === url.searchParams.get('note_id')?.replace(/^eq\./, '')),
          ),
        );
      if (method === 'POST') {
        files.push({ ...body, created_at: new Date().toISOString() } as TaskAttachment);
        return send({});
      }
      if (method === 'PATCH')
        Object.assign(
          files.find((f) => f.id === id)!,
          body,
        );
      if (method === 'DELETE') files = files.filter((f) => f.id !== id && !ids.includes(f.id));
      return returned({ id });
    }
    if (table === 'task_completions') {
      if (method === 'GET')
        return send(
          completed
            .filter((id) => tasks.some((t) => t.id === id && t.workspace_id === workspace))
            .map((task_id) => ({ task_id })),
        );
      const taskId =
        method === 'POST'
          ? String(body.task_id)
          : url.searchParams.get('task_id')?.replace(/^eq\./, '');
      if (method === 'POST') completed.push(taskId!);
      else completed = completed.filter((value) => value !== taskId);
      return returned({ task_id: taskId });
    }
    return send({ message: `Unexpected endpoint ${url.pathname}` }, 404);
  });
  return {
    requests,
    objects,
    tasks: () => tasks,
    externalCheck: (taskId: string, index: number, done: boolean) => {
      const record = tasks.find((task) => task.id === taskId)!;
      const task = normalizeTask(record, completed.includes(taskId));
      task.detailChecks![index] = {
        ...task.detailChecks![index],
        completed: done,
        completedBy: other,
        completedAt: new Date().toISOString(),
      };
      writeProgress(record, task);
      bump(record.workspace_id!, 'other-tab');
    },
    externalMove: (taskId: string, target: string) => {
      const record = tasks.find((task) => task.id === taskId)!,
        source = record.workspace_id!;
      record.workspace_id = target;
      for (const row of [...notes, ...files]) if (row.task_id === taskId) row.workspace_id = target;
      bump(source, 'other-tab');
      bump(target, 'other-tab');
    },
    failNextUpload: () => {
      failNextUpload = true;
    },
    revokeShared: () => {
      spaces = spaces.filter((s) => s.id !== SHARED_SPACE);
    },
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
  await expect(page.getByRole('button', { name: '공유 기록 새로고침', exact: true })).toBeEnabled();
}
