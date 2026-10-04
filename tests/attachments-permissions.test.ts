import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';

const OWNER = '10000000-0000-0000-0000-000000000001';
const EDITOR = '10000000-0000-0000-0000-000000000002';
const STRANGER = '10000000-0000-0000-0000-000000000003';
const UNVERIFIED = '10000000-0000-0000-0000-000000000004';
const SPACE = '20000000-0000-0000-0000-000000000001';
const TASK = '30000000-0000-0000-0000-000000000001';
let db: PGlite;
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function file(noteId: string | null = null, size = 123) {
  const id = randomUUID(),
    path = `${SPACE}/${TASK}/${id}`;
  await db.query(
    `insert into public.task_attachments(id,workspace_id,task_id,note_id,created_by,filename,mime_type,size_bytes,object_path)
    values($1,$2,$3,$4,$5,'설계.pdf','application/pdf',$6,$7)`,
    [id, SPACE, TASK, noteId, EDITOR, size, path],
  );
  return { id, path };
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    insert into auth.users values('${OWNER}','owner@example.com',now()),('${EDITOR}','editor@example.com',now()),('${STRANGER}','stranger@example.com',now()),('${UNVERIFIED}','unverified@example.com',null);
    create schema storage; grant usage on schema storage to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated; grant select on storage.objects to anon;`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  const migration = readFileSync(
    new URL('../supabase/migrations/20261005_task_files_and_personal_spaces.sql', import.meta.url),
    'utf8',
  );
  await db.exec(migration);
  await db.exec(migration); // Dashboard retries must preserve the installation.
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SPACE}','${OWNER}','승인받은 공간');
    insert into public.workspace_members(workspace_id,email) values('${SPACE}','editor@example.com');
    insert into public.tasks(id,workspace_id,created_by,title,date) values('${TASK}','${SPACE}','${OWNER}','보 설계','2026-10-05');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('personal provisioning is idempotent and keeps approved spaces separate', async () => {
  await asUser(EDITOR);
  const first = (await db.query<{ id: string }>('select public.ensure_personal_workspace() as id'))
    .rows[0].id;
  const second = (await db.query<{ id: string }>('select public.ensure_personal_workspace() as id'))
    .rows[0].id;
  expect(first).toBe(second);
  const spaces = (await db.query<{ owner_id: string }>('select owner_id from public.workspaces'))
    .rows;
  expect(spaces.map((s) => s.owner_id).sort()).toEqual([OWNER, EDITOR].sort());
  await asUser(OWNER);
  expect(
    (await db.query<{ id: string }>('select public.ensure_personal_workspace() as id')).rows[0].id,
  ).toBe(SPACE);
  await asUser(UNVERIFIED);
  await expect(db.query('select public.ensure_personal_workspace()')).rejects.toThrow(
    /Confirm your email/,
  );
  await db.exec('reset role; set role anon');
  await expect(db.query('select public.ensure_personal_workspace()')).rejects.toThrow(
    /permission denied/,
  );
});

test('approved people can leave notes but cannot edit another author or forge authorship', async () => {
  await asUser(EDITOR);
  const note = (
    await db.query<{ id: string }>(
      'insert into public.task_notes(workspace_id,task_id,created_by,body) values($1,$2,$3,$4) returning id',
      [SPACE, TASK, EDITOR, '휨 설계를 수행했습니다.'],
    )
  ).rows[0].id;
  await asUser(OWNER);
  const other = (
    await db.query<{ id: string }>(
      'insert into public.task_notes(workspace_id,task_id,created_by,body) values($1,$2,$3,$4) returning id',
      [SPACE, TASK, OWNER, '검토 의견'],
    )
  ).rows[0].id;
  await asUser(EDITOR);
  expect(
    (
      await db.query('update public.task_notes set body=$1 where id=$2 returning id', [
        '수정',
        other,
      ])
    ).rows,
  ).toHaveLength(0);
  await expect(
    db.query('insert into public.task_notes(workspace_id,task_id,created_by) values($1,$2,$3)', [
      SPACE,
      TASK,
      OWNER,
    ]),
  ).rejects.toThrow(/row-level security/);
  expect(
    (
      await db.query('update public.task_notes set body=$1 where id=$2 returning id', [
        '계산 완료',
        note,
      ])
    ).rows,
  ).toHaveLength(1);
  await asUser(STRANGER);
  expect((await db.query('select * from public.task_notes')).rows).toHaveLength(0);
});

test('files require a matching pending record; private objects and metadata cannot be forged', async () => {
  await asUser(EDITOR);
  const own = await file();
  await expect(
    db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
      'task-files',
      `${SPACE}/${TASK}/${randomUUID()}`,
    ]),
  ).rejects.toThrow(/row-level security/);
  await expect(
    db.query('update public.task_attachments set state=$1 where id=$2', ['ready', own.id]),
  ).rejects.toThrow(/Upload the file/);
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
    'task-files',
    own.path,
  ]);
  await db.query('update public.task_attachments set state=$1 where id=$2', ['ready', own.id]);
  await expect(
    db.query('update public.task_attachments set object_path=$1 where id=$2', ['forged', own.id]),
  ).rejects.toThrow(/permission denied/);
  await expect(file(null, 10485761)).rejects.toThrow(/check constraint/);
  await asUser(STRANGER);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  expect((await db.query('select * from public.task_attachments')).rows).toHaveLength(0);
  await db.exec('reset role; set role anon');
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  await expect(db.query('select * from public.task_attachments')).rejects.toThrow(
    /permission denied/,
  );
});

test('cross-space note references are rejected and attachments cannot be added to someone else’s note', async () => {
  await asUser(OWNER);
  const note = (
    await db.query<{ id: string }>(
      'insert into public.task_notes(workspace_id,task_id,created_by) values($1,$2,$3) returning id',
      [SPACE, TASK, OWNER],
    )
  ).rows[0].id;
  await asUser(EDITOR);
  await expect(file(note)).rejects.toThrow(/row-level security/);
  const ownSpace = (
    await db.query<{ id: string }>('select public.ensure_personal_workspace() as id')
  ).rows[0].id;
  await expect(
    db.query('insert into public.task_notes(workspace_id,task_id,created_by) values($1,$2,$3)', [
      ownSpace,
      TASK,
      EDITOR,
    ]),
  ).rejects.toThrow(/foreign key/);
});

test('unfinished uploads remain removable and database deletion cannot orphan an uploaded binary', async () => {
  await asUser(EDITOR);
  const pending = await file();
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
    'task-files',
    pending.path,
  ]);
  await expect(
    db.query('delete from public.task_attachments where id=$1', [pending.id]),
  ).rejects.toThrow(/Remove the file through Storage/);
  expect(
    (await db.query('delete from storage.objects where name=$1 returning id', [pending.path])).rows,
  ).toHaveLength(1);
  expect(
    (await db.query('delete from public.task_attachments where id=$1 returning id', [pending.id]))
      .rows,
  ).toHaveLength(1);
  await asUser(OWNER);
  await expect(db.query('delete from public.tasks where id=$1', [TASK])).rejects.toThrow(
    /Remove the file through Storage/,
  );
});

test('revocation removes object and note access; the owner can clean up all task files before cascade', async () => {
  await asUser(OWNER);
  await db.query('delete from public.workspace_members where workspace_id=$1', [SPACE]);
  await asUser(EDITOR);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  expect((await db.query('select * from public.task_notes')).rows).toHaveLength(0);
  await asUser(OWNER);
  await db.query("delete from storage.objects where bucket_id='task-files'");
  await db.query('delete from public.tasks where id=$1', [TASK]);
  expect((await db.query('select * from public.task_attachments')).rows).toHaveLength(0);
  expect((await db.query('select * from public.task_notes')).rows).toHaveLength(0);
});
