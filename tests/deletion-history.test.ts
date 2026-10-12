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
  ])
    await db.exec(readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SPACE}','${OWNER}','Shared');
    insert into public.workspace_members(workspace_id,email) values('${SPACE}','editor@example.com');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('unapproved account cannot prepare deletion or access archives', async () => {
  const id = await plan();
  await asUser(STRANGER);
  await expect(prepare(id)).rejects.toThrow(/access denied/);
  expect((await db.query('select * from public.task_deletion_history')).rows).toHaveLength(0);
});
test('disabled history fails closed before a deletion preparation is issued', async () => {
  const id = await plan();
  await db.exec('reset role; alter table public.tasks disable trigger dayly_deletion_history');
  await asUser(EDITOR);
  await expect(prepare(id)).rejects.toThrow(/not enabled/);
  await db.exec('reset role; alter table public.tasks enable trigger dayly_deletion_history');
});
test('deletion records actor and full plan, notes, completion and file metadata before cleanup', async () => {
  const id = await plan(),
    note = randomUUID(),
    file = randomUUID(),
    path = `${SPACE}/${id}/${file}`;
  await asUser(OWNER);
  await db.query(
    'insert into public.task_notes(id,workspace_id,task_id,created_by,body) values($1,$2,$3,$4,$5)',
    [note, SPACE, id, OWNER, '풀이 기록'],
  );
  await db.query(
    `insert into public.task_attachments(id,workspace_id,task_id,created_by,filename,mime_type,size_bytes,object_path) values($1,$2,$3,$4,'풀이.pdf','application/pdf',3,$5)`,
    [file, SPACE, id, OWNER, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query("update public.task_attachments set state='ready' where id=$1", [file]);
  await db.exec('reset role');
  await db.query(
    'insert into public.task_completions(task_id,workspace_id,completed_by) values($1,$2,$3)',
    [id, SPACE, OWNER],
  );
  await asUser(EDITOR);
  const prepared = await prepare(id);
  // Existing storage guard aborts the whole deletion, including audit inserts.
  await expect(
    db.query('select public.delete_task_with_history($1)', [prepared.operation_id]),
  ).rejects.toThrow(/Remove the file/);
  expect(
    (await db.query('select * from public.task_deletion_history where task_id=$1', [id])).rows,
  ).toHaveLength(0);
  await db.query("delete from storage.objects where bucket_id='task-files' and name=$1", [path]);
  await db.query('delete from public.task_attachments where id=$1', [file]);
  await db.query('select public.delete_task_with_history($1)', [prepared.operation_id]);
  const event = (
    await db.query<any>(
      "select * from public.task_deletion_history where task_id=$1 and entity_type='task'",
      [id],
    )
  ).rows[0];
  expect(event.deleted_by).toBe(EDITOR);
  expect(event.actor_role).toBe('authenticated');
  expect(event.snapshot.task.details).toBe('첫 항목\n두 번째');
  expect(event.snapshot.notes[0].body).toBe('풀이 기록');
  expect(event.snapshot.attachments[0].filename).toBe('풀이.pdf');
  expect(event.snapshot.completion.completed_by).toBe(OWNER);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(0);
  expect(
    (await db.query('select * from public.task_deletion_history where task_id=$1', [id])).rows,
  ).toHaveLength(3);
  await expect(
    db.query('delete from public.task_deletion_history where id=$1', [event.id]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query("update public.task_deletion_history set task_title='tampered' where id=$1", [
      event.id,
    ]),
  ).rejects.toThrow(/permission denied/);
  await asUser(STRANGER);
  expect(
    (await db.query('select * from public.task_deletion_history where task_id=$1', [id])).rows,
  ).toHaveLength(0);
});
test('a plan changed after preparation is not deleted using a stale snapshot', async () => {
  const id = await plan(),
    prepared = await prepare(id);
  await db.query('update public.tasks set title=$1 where id=$2', ['다른 창의 변경', id]);
  await expect(
    db.query('select public.delete_task_with_history($1)', [prepared.operation_id]),
  ).rejects.toThrow(/changed during deletion/);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(1);
});
test('direct administrator deletion also captures an archive and transaction rollback does not create a false event', async () => {
  const id = await plan();
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await db.exec('begin');
  await db.query('delete from public.tasks where id=$1', [id]);
  await db.exec('rollback');
  expect(
    (await db.query('select * from public.task_deletion_history where task_id=$1', [id])).rows,
  ).toHaveLength(0);
  await db.query('delete from public.tasks where id=$1', [id]);
  expect(
    (
      await db.query<{ deleted_by: string | null }>(
        'select deleted_by from public.task_deletion_history where task_id=$1',
        [id],
      )
    ).rows[0].deleted_by,
  ).toBeNull();
});
test('only server credentials export all workspaces and completion is recorded only after a valid upload receipt', async () => {
  await asUser(EDITOR);
  await expect(db.query('select public.create_planner_backup_snapshot()')).rejects.toThrow(
    /permission denied/,
  );
  await asUser('', 'anon');
  await expect(db.query('select public.create_planner_backup_snapshot()')).rejects.toThrow(
    /permission denied/,
  );
  await asUser('', 'service_role');
  const snapshot = (await db.query<any>('select public.create_planner_backup_snapshot() as value'))
    .rows[0].value;
  expect(snapshot.format).toBe('dayly-server-backup-v1');
  expect(snapshot.tables.workspaces[0].id).toBe(SPACE);
  expect(snapshot.tables.task_deletion_history.length).toBeGreaterThan(0);
  await asUser(EDITOR);
  const status = () =>
    db.query<any>('select public.get_workspace_backup_status($1) as value', [SPACE]);
  expect((await status()).rows[0].value.last_completed_at).toBeNull();
  await expect(db.query('select * from private.planner_backup_runs')).rejects.toThrow(
    /permission denied/,
  );
  await asUser('', 'service_role');
  await expect(
    db.query('select public.complete_planner_backup($1,null,null)', [snapshot.backup_id]),
  ).rejects.toThrow(/Invalid/);
  await db.query('select public.complete_planner_backup($1,$2,$3)', [
    snapshot.backup_id,
    '123',
    'a'.repeat(64),
  ]);
  await asUser(EDITOR);
  expect((await status()).rows[0].value.last_completed_at).toBeTruthy();
  await asUser(STRANGER);
  await expect(status()).rejects.toThrow(/access denied/);
});
