import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
const OWNER = '10000000-0000-0000-0000-000000000001',
  EDITOR = '10000000-0000-0000-0000-000000000002',
  STRANGER = '10000000-0000-0000-0000-000000000003';
const SPACE = '20000000-0000-0000-0000-000000000001';
let db: PGlite;
async function asUser(id: string, role = 'authenticated') {
  await db.exec(`reset role; set role ${role}`);
  await db.query(
    "select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",
    [id, role],
  );
}
async function plan() {
  await asUser(EDITOR);
  const id = randomUUID();
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date,details) values($1,$2,$3,$4,$5,$6)',
    [id, SPACE, EDITOR, '삭제 이력 확인', '2026-10-13', '첫 항목\n두 번째'],
  );
  return id;
}
async function prepare(id: string) {
  return (
    await db.query<{ value: { operation_id: string; attachments: unknown[] } }>(
      'select public.prepare_task_deletion($1,$2) as value',
      [id, SPACE],
    )
  ).rows[0].value;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; grant usage on schema auth to authenticated,service_role;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    insert into auth.users values('${OWNER}','owner@example.com',now()),('${EDITOR}','editor@example.com',now()),('${STRANGER}','stranger@example.com',now());
    create schema storage; grant usage on schema storage to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated;`);
  for (const file of [
    'schema.sql',
    'migrations/20261005_task_files_and_personal_spaces.sql',
    'migrations/20261006_shared_checks_and_moves.sql',
    'migrations/20261012_stable_workspace_members.sql',
    'migrations/20261013_deletion_history_and_backups.sql',
    'migrations/20261013_deletion_history_and_backups.sql',
    'migrations/20261017_permanent_planner_retention.sql',
    'migrations/20261017_permanent_planner_retention.sql',
  ])
    await db.exec(readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SPACE}','${OWNER}','Shared');
    insert into public.workspace_members(workspace_id,email) values('${SPACE}','editor@example.com');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('author and owner can save and read but cannot delete or move saved plans', async () => {
  const id = await plan();
  for (const actor of [EDITOR, OWNER]) {
    await asUser(actor);
    await expect(db.query('delete from public.tasks where id=$1', [id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(prepare(id)).rejects.toThrow(/cannot be deleted/);
    await expect(db.query('select public.move_task($1,$2,$3)', [id, SPACE, SPACE])).rejects.toThrow(
      /original workspace/,
    );
    expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(1);
    await db.query('select public.update_task_content($1,$2,$3,$4,$5)', [
      id,
      SPACE,
      '수정 가능',
      '2026-10-17',
      [],
    ]);
  }
});
test('administrator DELETE, TRUNCATE, identity changes and account cascades cannot remove plans', async () => {
  const id = await plan();
  await db.exec('reset role');
  await expect(db.query('delete from public.tasks where id=$1', [id])).rejects.toThrow(
    /cannot be deleted/,
  );
  await expect(db.exec('truncate public.tasks cascade')).rejects.toThrow(/cannot be deleted/);
  await expect(
    db.query('update public.tasks set created_by=$1 where id=$2', [OWNER, id]),
  ).rejects.toThrow(/original workspace/);
  await expect(db.query('delete from public.workspaces where id=$1', [SPACE])).rejects.toThrow(
    /cannot be deleted/,
  );
  await expect(db.query('delete from auth.users where id=$1', [OWNER])).rejects.toThrow(
    /cannot be deleted/,
  );
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(1);
});
test('saved notes and ready originals survive both old browser cleanup and privileged deletion', async () => {
  const id = await plan(),
    note = randomUUID(),
    file = randomUUID(),
    path = SPACE + '/' + id + '/' + file;
  await db.query(
    'insert into public.task_notes(id,workspace_id,task_id,created_by,body) values($1,$2,$3,$4,$5)',
    [note, SPACE, id, EDITOR, '보존할 풀이'],
  );
  await db.query(
    "insert into public.task_attachments(id,workspace_id,task_id,created_by,filename,mime_type,size_bytes,object_path) values($1,$2,$3,$4,'풀이.pdf','application/pdf',3,$5)",
    [file, SPACE, id, EDITOR, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query("update public.task_attachments set state='ready' where id=$1", [file]);
  await db.query("delete from storage.objects where bucket_id='task-files' and name=$1", [path]);
  expect((await db.query('select * from storage.objects where name=$1', [path])).rows).toHaveLength(
    1,
  );
  await expect(
    db.query("update public.task_attachments set state='pending' where id=$1", [file]),
  ).rejects.toThrow(/cannot be replaced/);
  await expect(db.query('delete from public.task_notes where id=$1', [note])).rejects.toThrow(
    /permission denied/,
  );
  await db.exec('reset role');
  await expect(db.query('delete from public.task_notes where id=$1', [note])).rejects.toThrow(
    /cannot be deleted/,
  );
  await expect(db.query('delete from public.task_attachments where id=$1', [file])).rejects.toThrow(
    /cannot be deleted/,
  );
  await expect(db.query('delete from storage.objects where name=$1', [path])).rejects.toThrow(
    /cannot be deleted/,
  );
  await expect(
    db.query("update storage.objects set name=name||'-moved' where name=$1", [path]),
  ).rejects.toThrow(/cannot be deleted/);
});
test('unfinished uploads can be cleaned up and revoked participants do not remove the owner records', async () => {
  const id = await plan(),
    file = randomUUID(),
    path = SPACE + '/' + id + '/' + file;
  await db.query(
    "insert into public.task_attachments(id,workspace_id,task_id,created_by,filename,mime_type,size_bytes,object_path) values($1,$2,$3,$4,'retry.pdf','application/pdf',3,$5)",
    [file, SPACE, id, EDITOR, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query('delete from storage.objects where name=$1', [path]);
  await db.query('delete from public.task_attachments where id=$1', [file]);
  await asUser(OWNER);
  await db.query('delete from public.workspace_members where workspace_id=$1', [SPACE]);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(1);
  await asUser(EDITOR);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(0);
});
test('retention status requires membership and detects a disabled protection trigger', async () => {
  await asUser(OWNER);
  expect(
    (await db.query<any>('select public.get_planner_retention_status($1) as value', [SPACE]))
      .rows[0].value,
  ).toEqual({ version: 1, enabled: true });
  await db.exec('reset role; alter table public.tasks disable trigger dayly_retain_plan');
  await asUser(OWNER);
  expect(
    (await db.query<any>('select public.get_planner_retention_status($1) as value', [SPACE]))
      .rows[0].value.enabled,
  ).toBe(false);
  await db.exec('reset role; alter table public.tasks enable trigger dayly_retain_plan');
  await asUser(STRANGER);
  await expect(db.query('select public.get_planner_retention_status($1)', [SPACE])).rejects.toThrow(
    /access denied/,
  );
});
