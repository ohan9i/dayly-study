import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, expect, test } from 'vitest';

// Executes the actual production SQL against PostgreSQL, with Supabase's auth
// identity functions emulated. This verifies database enforcement beyond UI buttons.
const OWNER = '10000000-0000-0000-0000-000000000001';
const EDITOR = '10000000-0000-0000-0000-000000000002';
const STRANGER = '10000000-0000-0000-0000-000000000003';
const UNVERIFIED = '10000000-0000-0000-0000-000000000004';
const SPACE = '20000000-0000-0000-0000-000000000001';
const TASK = '30000000-0000-0000-0000-000000000001';
let db: PGlite;
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated;');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    insert into auth.users values
      ('${OWNER}','owner@example.com',now()),('${EDITOR}','editor@example.com',now()),
      ('${STRANGER}','stranger@example.com',now()),('${UNVERIFIED}','unverified@example.com',null);`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SPACE}','${OWNER}','Study');
    insert into public.workspace_members(workspace_id,email) values('${SPACE}','editor@example.com'),('${SPACE}','unverified@example.com');
    insert into public.tasks(id,workspace_id,created_by,title,subject,date) values('${TASK}','${SPACE}','${OWNER}','구조 역학','전공','2026-10-04');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});
test('anonymous visitors cannot read study records', async () => {
  await db.exec('reset role; set role anon');
  await expect(db.query('select * from public.tasks')).rejects.toThrow(/permission denied/);
});
test('unapproved accounts cannot see the workspace or write into it', async () => {
  await asUser(STRANGER);
  expect((await db.query('select * from public.workspaces')).rows).toHaveLength(0);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
  await expect(
    db.query(
      `insert into public.tasks(workspace_id,created_by,title,subject,date) values($1,$2,'intrusion','전공','2026-10-04')`,
      [SPACE, STRANGER],
    ),
  ).rejects.toThrow(/row-level security/);
});
test('an approved but unverified email cannot access records', async () => {
  await asUser(UNVERIFIED);
  expect((await db.query('select * from public.workspaces')).rows).toHaveLength(0);
});
test('approved editors can read and create their own tasks and study logs', async () => {
  await asUser(EDITOR);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(1);
  const result = await db.query<{ id: string }>(
    `insert into public.tasks(workspace_id,created_by,title,subject,date) values($1,$2,'건축 계획','전공','2026-10-04') returning id`,
    [SPACE, EDITOR],
  );
  await db.query('update public.tasks set title=$1 where id=$2', ['계획 수정', result.rows[0].id]);
  expect(
    (
      await db.query<{ title: string }>('select title from public.tasks where id=$1', [
        result.rows[0].id,
      ])
    ).rows[0].title,
  ).toBe('계획 수정');
  await db.query(
    `insert into public.study_logs(workspace_id,created_by,title,subject,date,minutes) values($1,$2,'공부 기록','전공','2026-10-04',30)`,
    [SPACE, EDITOR],
  );
});
test('editors cannot alter another author, complete tasks, or approve new people', async () => {
  await asUser(EDITOR);
  await db.query('update public.tasks set title=$1 where id=$2', ['tampered', TASK]);
  expect(
    (await db.query<{ title: string }>('select title from public.tasks where id=$1', [TASK]))
      .rows[0].title,
  ).toBe('구조 역학');
  await expect(
    db.query('update public.tasks set created_by=$1 where id=$2', [EDITOR, TASK]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query(
      `insert into public.task_completions(task_id,workspace_id,completed_by) values($1,$2,$3)`,
      [TASK, SPACE, EDITOR],
    ),
  ).rejects.toThrow(/row-level security/);
  await expect(
    db.query(
      `insert into public.workspace_members(workspace_id,email) values($1,'other@example.com')`,
      [SPACE],
    ),
  ).rejects.toThrow(/row-level security/);
});
test('owner can check a task, and completion is removed when the task is deleted', async () => {
  await asUser(OWNER);
  await db.query(
    'insert into public.task_completions(task_id,workspace_id,completed_by) values($1,$2,$3)',
    [TASK, SPACE, OWNER],
  );
  expect((await db.query('select * from public.task_completions')).rows).toHaveLength(1);
  await db.query('delete from public.tasks where id=$1', [TASK]);
  expect((await db.query('select * from public.task_completions')).rows).toHaveLength(0);
});
test('revoking an editor immediately removes database access', async () => {
  await asUser(OWNER);
  await db.query(
    `delete from public.workspace_members where workspace_id=$1 and email='editor@example.com'`,
    [SPACE],
  );
  await asUser(EDITOR);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
  expect((await db.query('select * from public.study_logs')).rows).toHaveLength(0);
});
test('a signed-in user can create and read their own workspace without impersonating an owner', async () => {
  await asUser(STRANGER);
  const result = await db.query<{ id: string }>(
    'insert into public.workspaces(owner_id,name) values($1,$2) returning id',
    [STRANGER, '나의 공간'],
  );
  expect(result.rows).toHaveLength(1);
  await expect(
    db.query('insert into public.workspaces(owner_id,name) values($1,$2)', [OWNER, '가짜 소유자']),
  ).rejects.toThrow(/row-level security/);
});
