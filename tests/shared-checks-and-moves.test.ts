import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  normalizeTask,
  duplicateTaskPlan,
  encodeTaskProgress,
  type TaskRecord,
} from '../src/domain';

const OWNER = '10000000-0000-0000-0000-000000000001',
  MEMBER = '10000000-0000-0000-0000-000000000002',
  OTHER = '10000000-0000-0000-0000-000000000003',
  UNVERIFIED = '10000000-0000-0000-0000-000000000004';
const SOURCE = '20000000-0000-0000-0000-000000000001',
  TARGET = '20000000-0000-0000-0000-000000000002',
  PRIVATE = '20000000-0000-0000-0000-000000000003',
  TASK = '30000000-0000-0000-0000-000000000001';
let db: PGlite;
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function check(id: string | null, done: boolean) {
  return normalizeTask(
    (
      await db.query<TaskRecord>('select * from public.set_task_completion($1,$2,$3,$4)', [
        TASK,
        SOURCE,
        done,
        id,
      ])
    ).rows[0],
  );
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    insert into auth.users values('${OWNER}','owner@example.com',now()),('${MEMBER}','member@example.com',now()),
      ('${OTHER}','other@example.com',now()),('${UNVERIFIED}','unverified@example.com',null);
    create schema storage; grant usage on schema storage to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated;
    grant select on storage.objects to anon;`);
  for (const path of [
    'schema.sql',
    'migrations/20261005_task_files_and_personal_spaces.sql',
    'migrations/20261006_shared_checks_and_moves.sql',
  ])
    await db.exec(readFileSync(new URL(`../supabase/${path}`, import.meta.url), 'utf8'));
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/20261006_shared_checks_and_moves.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SOURCE}','${OWNER}','Source'),('${TARGET}','${MEMBER}','Target'),('${PRIVATE}','${OTHER}','Private');
    insert into public.workspace_members(workspace_id,email) values('${SOURCE}','member@example.com'),('${SOURCE}','unverified@example.com');
    insert into public.tasks(id,workspace_id,created_by,title,date,details) values('${TASK}','${SOURCE}','${MEMBER}','Keep all data','2026-10-03',E'First\nSecond');`);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('members check/uncheck legacy subtasks and parent; server records actor/time, author permissions remain', async () => {
  await asUser(MEMBER);
  const task = await check(`${TASK}-detail-0`, true);
  expect(task.detailChecks?.map((c) => c.completed)).toEqual([true, false]);
  expect(task.detailChecks?.[0].completedBy).toBe(MEMBER);
  expect(task.detailChecks?.[0].completedAt).toBeTruthy();
  await asUser(OWNER);
  const second = await check(`${TASK}-detail-1`, true);
  expect(second.detailChecks?.map((c) => c.completed)).toEqual([true, true]);
  expect(second.detailChecks?.[0].completedBy).toBe(MEMBER);
  expect(second.completedBy).toBe(OWNER);
  expect((await check(null, false)).detailChecks?.map((c) => c.completed)).toEqual([false, false]);
  expect((await check(null, true)).completed).toBe(true);
  await expect(
    db.query('update public.tasks set details=$1 where id=$2', ['stale', TASK]),
  ).rejects.toThrow(/permission denied/);
  await expect(
    db.query('delete from public.task_completions where task_id=$1', [TASK]),
  ).rejects.toThrow(/permission denied/);
  await asUser(OTHER);
  await expect(check(null, true)).rejects.toThrow(/access denied/);
  await asUser(UNVERIFIED);
  await expect(check(null, true)).rejects.toThrow(/access denied/);
  await db.exec('reset role; set role anon');
  await expect(check(null, true)).rejects.toThrow(/permission denied/);
});

test('stale desired-state requests and stale content edits preserve other participant checks', async () => {
  await asUser(MEMBER);
  await check(null, false);
  const first = await check(`${TASK}-detail-0`, true);
  await asUser(OWNER);
  await check(`${TASK}-detail-1`, true);
  // Same stale intent sets true again, never toggles the already completed item.
  const repeated = await check(`${TASK}-detail-0`, true);
  expect(repeated.detailChecks?.map((c) => c.completed)).toEqual([true, true]);
  expect(repeated.detailChecks?.[0].completedBy).toBe(first.detailChecks?.[0].completedBy);
  await asUser(MEMBER);
  const result = await db.query<TaskRecord>(
    'select * from public.update_task_content($1,$2,$3,$4,$5)',
    [
      TASK,
      SOURCE,
      'Renamed',
      '2026-10-03',
      JSON.stringify(first.details.map((text, i) => ({ id: first.detailChecks![i].id, text }))),
    ],
  );
  const task = normalizeTask(result.rows[0]);
  expect(task.detailChecks?.map((c) => c.completed)).toEqual([true, true]);
  expect(task.detailChecks?.[1].completedBy).toBe(OWNER);
  expect(task.revision).toBeGreaterThan(first.revision!);
});

test('existing RLS permits copying another author, restricts target/identity and keeps source editing forbidden', async () => {
  await asUser(OWNER);
  const original = (
    await db.query<TaskRecord>(
      `insert into public.tasks(workspace_id,created_by,title,date,details)
     values($1,$2,'Owner plan','2026-10-03',E'First\nSecond') returning *`,
      [SOURCE, OWNER],
    )
  ).rows[0];
  let copyId: string | null = null;
  try {
    await asUser(MEMBER);
    const visible = (
      await db.query<TaskRecord>('select * from public.tasks where id=$1', [original.id])
    ).rows[0];
    const copy = duplicateTaskPlan(normalizeTask(visible), '2026-10-09', MEMBER, SOURCE);
    copyId = copy.id;
    const insert = (space = SOURCE, author = MEMBER) =>
      db.query<TaskRecord>(
        'insert into public.tasks(id,workspace_id,created_by,title,date,details,detail_items) values($1,$2,$3,$4,$5,$6,$7) returning *',
        [
          copy.id,
          space,
          author,
          copy.title,
          copy.date,
          encodeTaskProgress(copy, new Set()),
          copy.details,
        ],
      );
    await expect(insert(PRIVATE)).rejects.toThrow(/row-level security/);
    await expect(insert(SOURCE, OWNER)).rejects.toThrow(/row-level security/);
    const saved = normalizeTask((await insert()).rows[0]);
    expect(saved.created_by).toBe(MEMBER);
    expect(saved.detailChecks!.every((check) => !check.completed)).toBe(true);
    expect(saved.detailChecks!.map((check) => check.id)).not.toEqual(
      normalizeTask(visible).detailChecks!.map((check) => check.id),
    );
    await expect(
      db.query('select public.update_task_content($1,$2,$3,$4,$5)', [
        original.id,
        SOURCE,
        'tampered',
        '2026-10-09',
        '[]',
      ]),
    ).rejects.toThrow(/Only the author or workspace owner can edit/);
    await db.query('select public.update_task_content($1,$2,$3,$4,$5)', [
      copy.id,
      SOURCE,
      'Independent copy',
      '2026-10-09',
      JSON.stringify(saved.details.map((text, i) => ({ text, id: saved.detailChecks![i].id }))),
    ]);
    expect(
      (await db.query<TaskRecord>('select * from public.tasks where id=$1', [original.id])).rows[0],
    ).toEqual(original);
    for (const user of [OTHER, UNVERIFIED]) {
      await asUser(user);
      expect(
        (await db.query('select * from public.tasks where id=$1', [original.id])).rows,
      ).toHaveLength(0);
      await expect(insert(SOURCE, user)).rejects.toThrow(/row-level security/);
    }
    await db.exec('reset role; set role anon');
    await expect(db.query('select * from public.tasks where id=$1', [original.id])).rejects.toThrow(
      /permission denied/,
    );
    await expect(insert()).rejects.toThrow(/permission denied/);
  } finally {
    await db.exec('reset role');
    await db.query('delete from public.tasks where id=$1 or id=$2', [original.id, copyId]);
  }
});

test('move is authorized and atomic, preserves IDs, notes, file bytes/path, timestamps and completion', async () => {
  await asUser(MEMBER);
  await expect(
    db.query('select public.move_task($1,$2,$3)', [TASK, SOURCE, PRIVATE]),
  ).rejects.toThrow(/access denied/);
  await expect(
    db.query('select public.move_task($1,$2,$3)', [TASK, SOURCE, SOURCE]),
  ).rejects.toThrow(/another workspace/);
  const note = (
    await db.query<{ id: string; updated_at: string }>(
      `insert into public.task_notes(workspace_id,task_id,created_by,body)
    values($1,$2,$3,'dayly:detail-note:v1:{"detailId":"kept","body":"Record"}') returning id,updated_at`,
      [SOURCE, TASK, MEMBER],
    )
  ).rows[0];
  const fileId = '40000000-0000-0000-0000-000000000001',
    path = `${SOURCE}/${TASK}/${fileId}`;
  await db.query(
    `insert into public.task_attachments(id,workspace_id,task_id,note_id,created_by,filename,mime_type,size_bytes,object_path)
    values($1,$2,$3,$4,$5,'kept.pdf','application/pdf',123,$6)`,
    [fileId, SOURCE, TASK, note.id, MEMBER, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query("update public.task_attachments set state='ready' where id=$1", [fileId]);
  const before = (await db.query<TaskRecord>('select * from public.tasks where id=$1', [TASK]))
    .rows[0];
  const moved = (
    await db.query<TaskRecord>('select * from public.move_task($1,$2,$3)', [TASK, SOURCE, TARGET])
  ).rows[0];
  expect({ ...moved, workspace_id: SOURCE, revision: before.revision }).toEqual(before);
  const notes = (
    await db.query<{ workspace_id: string; updated_at: string }>(
      'select * from public.task_notes where id=$1',
      [note.id],
    )
  ).rows;
  expect(notes[0].workspace_id).toBe(TARGET);
  expect(notes[0].updated_at).toEqual(note.updated_at);
  const file = (
    await db.query<{ workspace_id: string; object_path: string }>(
      'select * from public.task_attachments where id=$1',
      [fileId],
    )
  ).rows[0];
  expect(file.workspace_id).toBe(TARGET);
  expect(file.object_path).toBe(path);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
  expect(
    (await db.query('select * from public.task_completions where workspace_id=$1', [TARGET])).rows,
  ).toHaveLength(1);
  await expect(check(null, false)).rejects.toThrow(/moved or deleted/);
  await asUser(OWNER);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
  expect((await db.query('select * from public.task_notes')).rows).toHaveLength(0);
  expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
  const activity = (await db.query('select * from public.workspace_activity')).rows;
  expect(activity).toHaveLength(1); // Only source activity is visible.
});

test('a participant without content permission cannot edit/delete/move someone else’s item', async () => {
  await db.exec('reset role');
  const id = '30000000-0000-0000-0000-000000000002';
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date) values($1,$2,$3,$4,$5)',
    [id, SOURCE, OWNER, 'Owner task', '2026-10-06'],
  );
  await asUser(MEMBER);
  expect(
    (await db.query('update public.tasks set title=$1 where id=$2 returning id', ['Denied', id]))
      .rows,
  ).toHaveLength(0);
  expect(
    (await db.query('delete from public.tasks where id=$1 returning id', [id])).rows,
  ).toHaveLength(0);
  await expect(
    db.query('select public.update_task_content($1,$2,$3,$4,$5)', [
      id,
      SOURCE,
      'Denied',
      '2026-10-06',
      '[]',
    ]),
  ).rejects.toThrow(/Only the author/);
  await expect(db.query('select public.move_task($1,$2,$3)', [id, SOURCE, TARGET])).rejects.toThrow(
    /Only the author/,
  );
  expect(
    (await db.query('select public.set_task_completion($1,$2,true)', [id, SOURCE])).rows,
  ).toHaveLength(1);
  await expect(
    db.query('update public.tasks set workspace_id=$1 where id=$2', [TARGET, id]),
  ).rejects.toThrow(/permission denied/);
});
