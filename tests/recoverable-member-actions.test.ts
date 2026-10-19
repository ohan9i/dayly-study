import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  duplicateTaskPlan,
  encodeTaskProgress,
  normalizeTask,
  type TaskRecord,
} from '../src/domain';
const OWNER = '10000000-0000-0000-0000-000000000001',
  EDITOR = '10000000-0000-0000-0000-000000000002',
  STRANGER = '10000000-0000-0000-0000-000000000003';
const SPACE = '20000000-0000-0000-0000-000000000001';
let db: PGlite;
let legacy: string;
const TARGET = '20000000-0000-0000-0000-000000000002';
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
  legacy = await plan();
  await db.query(
    'insert into public.task_notes(workspace_id,task_id,created_by,body) values($1,$2,$3,$4)',
    [SPACE, legacy, EDITOR, '과거 풀이'],
  );
  const operation = await prepare(legacy);
  await db.query('select public.delete_task_with_history($1)', [operation.operation_id]);
  await db.exec('reset role');
  for (const file of [
    '20261017_permanent_planner_retention.sql',
    '20261017_recoverable_member_actions.sql',
    '20261017_recoverable_member_actions.sql',
    '20261019_member_task_duplication.sql',
    '20261019_member_task_duplication.sql',
    '20261019_compact_task_duplication.sql',
    '20261019_compact_task_duplication.sql',
  ])
    await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
  await db.query('insert into public.workspaces(id,owner_id,name) values($1,$2,$3)', [
    TARGET,
    OWNER,
    'Target',
  ]);
  await db.query('insert into public.workspace_members(workspace_id,email) values($1,$2)', [
    TARGET,
    'editor@example.com',
  ]);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('approved nonauthor duplicates an owner plan under all current database protections', async () => {
  await asUser(OWNER);
  const id = randomUUID();
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date,details) values($1,$2,$3,$4,$5,$6)',
    [id, SPACE, OWNER, '복제할 원본', '2026-10-19', '첫 항목\n두 번째'],
  );
  await asUser(EDITOR);
  const source = (await db.query<TaskRecord>('select * from public.tasks where id=$1', [id]))
    .rows[0];
  const copy = duplicateTaskPlan(normalizeTask(source), '2026-10-20', EDITOR, SPACE);
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date,details,detail_items) values($1,$2,$3,$4,$5,$6,$7)',
    [
      copy.id,
      SPACE,
      EDITOR,
      copy.title,
      copy.date,
      encodeTaskProgress(copy, new Set()),
      copy.details,
    ],
  );
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows[0]).toEqual(source);
  expect(
    (await db.query<any>('select created_by from public.tasks where id=$1', [copy.id])).rows[0]
      .created_by,
  ).toBe(EDITOR);
});

test('server copy preserves a maximum-length plan including spaces and JSON escapes', async () => {
  await asUser(OWNER);
  const id = randomUUID();
  const task = normalizeTask({
    id,
    workspace_id: SPACE,
    created_by: OWNER,
    title: '저장 한도 원본',
    date: '2026-10-19',
    details: ['공백 , : "따옴표" \\ 경로\t안쪽\n줄바꿈 끝', '마지막'],
    detailChecks: [
      { id: randomUUID(), completed: false },
      { id: randomUUID(), completed: false },
    ],
  });
  task.details[0] += '가'.repeat(10000 - encodeTaskProgress(task, new Set()).length);
  const encoded = encodeTaskProgress(task, new Set());
  expect(encoded).toHaveLength(10000);
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date,details,detail_items) values($1,$2,$3,$4,$5,$6,$7)',
    [id, SPACE, OWNER, task.title, task.date, encoded, task.details],
  );
  await asUser(EDITOR);
  const copy = (
    await db.query<TaskRecord>('select t.* from public.duplicate_task($1,$2,$3) t', [
      id,
      SPACE,
      '2026-10-20',
    ])
  ).rows[0];
  expect(normalizeTask(copy).details).toEqual(task.details);
  expect(copy.details).toHaveLength(10000);
  expect(
    (await db.query<{ details: string }>('select details from public.tasks where id=$1', [id]))
      .rows[0].details,
  ).toBe(encoded);
});

test('server copy of a completed title-only plan has no details and starts incomplete', async () => {
  await asUser(OWNER);
  const id = randomUUID();
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date) values($1,$2,$3,$4,$5)',
    [id, SPACE, OWNER, '제목만 있는 원본', '2026-10-19'],
  );
  await db.query('select public.set_task_completion($1,$2,true)', [id, SPACE]);
  await asUser(EDITOR);
  const record = (
    await db.query<TaskRecord>('select t.* from public.duplicate_task($1,$2,$3) t', [
      id,
      SPACE,
      '2026-10-20',
    ])
  ).rows[0];
  expect(normalizeTask(record)).toMatchObject({ details: [], detailChecks: [], completed: false });
  expect(record.detail_items).toEqual([]);
});

test('server copy revalidates membership, resets progress and preserves the source and its records', async () => {
  await asUser(OWNER);
  const id = randomUUID();
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date,details) values($1,$2,$3,$4,$5,$6)',
    [id, SPACE, OWNER, '공유 원본', '2026-10-19', '순열\n같은 내용\n같은 내용'],
  );
  await db.query('select public.set_task_completion($1,$2,true)', [id, SPACE]);
  await db.query(
    'insert into public.task_notes(workspace_id,task_id,created_by,body) values($1,$2,$3,$4)',
    [SPACE, id, OWNER, '보존할 기록'],
  );
  const source = (await db.query<TaskRecord>('select * from public.tasks where id=$1', [id]))
    .rows[0];
  const request = randomUUID();
  await asUser(EDITOR);
  const record = (
    await db.query<TaskRecord>(
      'select t.*,t.date::text as date from public.duplicate_task($1,$2,$3,$4) t',
      [id, SPACE, '2026-10-20', request],
    )
  ).rows[0];
  const copy = normalizeTask(record);
  expect(copy.created_by).toBe(EDITOR);
  expect(copy.workspace_id).toBe(SPACE);
  expect(copy.date).toBe('2026-10-20');
  expect(copy.details).toEqual(['순열', '같은 내용', '같은 내용']);
  expect(copy.detailChecks!.every((c) => !c.completed && !c.completedBy && !c.completedAt)).toBe(
    true,
  );
  expect(new Set(copy.detailChecks!.map((c) => c.id)).size).toBe(3);
  expect(
    copy.detailChecks!.every(
      (c) => !normalizeTask(source).detailChecks!.some((s) => s.id === c.id),
    ),
  ).toBe(true);
  for (const table of ['task_notes', 'task_attachments', 'task_completions'])
    expect(
      (await db.query(`select * from public.${table} where task_id=$1`, [copy.id])).rows,
    ).toHaveLength(0);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows[0]).toEqual(source);
  expect(
    (
      await db.query<any>(
        'select changed_by,request_id from public.task_change_history where task_id=$1',
        [copy.id],
      )
    ).rows[0],
  ).toMatchObject({ changed_by: EDITOR, request_id: request });
  await expect(
    db.query('select public.update_task_content($1,$2,$3,$4,$5)', [
      id,
      SPACE,
      '원본 수정 시도',
      '2026-10-19',
      '[]',
    ]),
  ).rejects.toThrow(/Only the author/);
  await db.query('select public.archive_task($1,$2)', [id, SPACE]);
  await expect(
    db.query('select public.duplicate_task($1,$2,$3)', [id, SPACE, '2026-10-20']),
  ).rejects.toThrow(/unavailable/);
  await asUser(STRANGER);
  await expect(
    db.query('select public.duplicate_task($1,$2,$3)', [copy.id, SPACE, '2026-10-20']),
  ).rejects.toThrow(/access denied/);
  await asUser(EDITOR, 'anon');
  await expect(
    db.query('select public.duplicate_task($1,$2,$3)', [copy.id, SPACE, '2026-10-20']),
  ).rejects.toThrow(/permission denied/);
});

test('invalid copy dates and mismatched source workspace cannot create a plan', async () => {
  const id = await plan();
  const before = (await db.query('select id from public.tasks')).rows;
  await expect(db.query('select public.duplicate_task($1,$2,null)', [id, SPACE])).rejects.toThrow(
    /valid copy date/,
  );
  await expect(
    db.query('select public.duplicate_task($1,$2,$3)', [id, TARGET, '2026-10-20']),
  ).rejects.toThrow(/unavailable/);
  expect((await db.query('select id from public.tasks')).rows).toEqual(before);
});

test('an approved nonauthor can delete and restore without losing notes, checks or original bytes', async () => {
  const id = await plan(),
    file = randomUUID(),
    path = SPACE + '/' + id + '/' + file;
  await db.query(
    "insert into public.task_attachments(id,workspace_id,task_id,created_by,filename,mime_type,size_bytes,object_path) values($1,$2,$3,$4,'원본.pdf','application/pdf',3,$5)",
    [file, SPACE, id, EDITOR, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query("update public.task_attachments set state='ready' where id=$1", [file]);
  await db.exec('reset role');
  await db.query('update public.tasks set created_by=created_by where id=$1', [id]);
  await asUser(OWNER);
  await db.query('select public.archive_task($1,$2)', [id, SPACE]);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(0);
  expect(
    (
      await db.query<any>('select public.get_deleted_tasks($1) as value', [SPACE])
    ).rows[0].value.some((x: any) => x.id === id),
  ).toBe(true);
  expect((await db.query('select * from storage.objects where name=$1', [path])).rows).toHaveLength(
    1,
  );
  await asUser(EDITOR);
  await db.query('select public.restore_task($1,$2)', [id, SPACE]);
  expect((await db.query('select * from public.tasks where id=$1', [id])).rows).toHaveLength(1);
  expect(
    (await db.query('select * from public.task_attachments where id=$1', [file])).rows,
  ).toHaveLength(1);
  const operations = (
    await db.query<any>(
      'select operation from public.task_change_history where task_id=$1 order by changed_at',
      [id],
    )
  ).rows.map((x) => x.operation);
  expect(operations).toContain('archive');
  expect(operations).toContain('restore');
});
test('an approved participant can move another author plan and its ready attachment atomically', async () => {
  await asUser(OWNER);
  const id = randomUUID();
  await db.query(
    'insert into public.tasks(id,workspace_id,created_by,title,date) values($1,$2,$3,$4,$5)',
    [id, SPACE, OWNER, '다른 작성자 계획', '2026-10-15'],
  );
  const note = randomUUID(),
    file = randomUUID(),
    path = SPACE + '/' + id + '/' + file;
  await db.query(
    'insert into public.task_notes(id,workspace_id,task_id,created_by,body) values($1,$2,$3,$4,$5)',
    [note, SPACE, id, OWNER, '이동할 기록'],
  );
  await db.query(
    "insert into public.task_attachments(id,workspace_id,task_id,note_id,created_by,filename,mime_type,size_bytes,object_path) values($1,$2,$3,$4,$5,'원본.pdf','application/pdf',3,$6)",
    [file, SPACE, id, note, OWNER, path],
  );
  await db.query("insert into storage.objects(bucket_id,name) values('task-files',$1)", [path]);
  await db.query("update public.task_attachments set state='ready' where id=$1", [file]);
  await asUser(EDITOR);
  await db.query('select public.move_task($1,$2,$3)', [id, SPACE, TARGET]);
  expect(
    (await db.query<any>('select workspace_id from public.tasks where id=$1', [id])).rows[0]
      .workspace_id,
  ).toBe(TARGET);
  expect(
    (
      await db.query<any>(
        'select workspace_id,object_path from public.task_attachments where id=$1',
        [file],
      )
    ).rows[0],
  ).toEqual({ workspace_id: TARGET, object_path: path });
  expect(
    (
      await db.query<any>(
        'select operation,changed_by from public.task_change_history where task_id=$1 and operation=$2',
        [id, 'move'],
      )
    ).rows[0].changed_by,
  ).toBe(EDITOR);
});
test('unapproved accounts cannot archive, restore, list trash or move', async () => {
  const id = await plan();
  await asUser(STRANGER);
  for (const query of [
    'select public.archive_task($1,$2)',
    'select public.restore_task($1,$2)',
    'select public.move_task($1,$2,$3)',
  ])
    await expect(
      db.query(query, query.includes('$3') ? [id, SPACE, TARGET] : [id, SPACE]),
    ).rejects.toThrow(/access denied/);
  await expect(db.query('select public.get_deleted_tasks($1)', [SPACE])).rejects.toThrow(
    /access denied/,
  );
  expect((await db.query('select * from public.task_change_history')).rows).toHaveLength(0);
});
test('legacy clients prepare no binary cleanup and stale prepared deletes are rejected', async () => {
  const id = await plan(),
    p = await prepare(id);
  expect(p.attachments).toEqual([]);
  await db.query('update public.tasks set title=$1 where id=$2', ['바뀐 계획', id]);
  await expect(
    db.query('select public.delete_task_with_history($1)', [p.operation_id]),
  ).rejects.toThrow(/changed/);
  const fresh = await prepare(id);
  await db.query('select public.delete_task_with_history($1)', [fresh.operation_id]);
  await db.exec('reset role');
  expect(
    (await db.query<any>('select deleted_at from public.tasks where id=$1', [id])).rows[0]
      .deleted_at,
  ).toBeTruthy();
  await expect(db.query('delete from public.tasks where id=$1', [id])).rejects.toThrow(
    /Physical deletion/,
  );
  await expect(db.exec('truncate public.tasks cascade')).rejects.toThrow(/Physical deletion/);
});
test('previously hard-deleted plans restore original IDs, dates and notes without duplication', async () => {
  await asUser(EDITOR);
  await db.query('select public.restore_task($1,$2)', [legacy, SPACE]);
  await db.query('select public.restore_task($1,$2)', [legacy, SPACE]);
  expect(
    (await db.query<any>('select date::text from public.tasks where id=$1', [legacy])).rows[0].date,
  ).toBe('2026-10-13');
  expect(
    (await db.query<any>('select body from public.task_notes where task_id=$1', [legacy])).rows[0]
      .body,
  ).toBe('과거 풀이');
  expect((await db.query('select * from public.tasks where id=$1', [legacy])).rows).toHaveLength(1);
});
test('date changes are attributed and audit cannot be erased by a browser account', async () => {
  const id = await plan();
  await db.query('update public.tasks set date=$1 where id=$2', ['2026-10-12', id]);
  const event = (
    await db.query<any>(
      "select * from public.task_change_history where task_id=$1 and operation='date_change'",
      [id],
    )
  ).rows[0];
  expect(event.before_record.date).toBe('2026-10-13');
  expect(event.after_record.date).toBe('2026-10-12');
  expect(event.changed_by).toBe(EDITOR);
  await expect(
    db.query('delete from public.task_change_history where id=$1', [event.id]),
  ).rejects.toThrow(/permission denied/);
  expect(
    (await db.query<any>('select public.get_planner_retention_status($1) as value', [SPACE]))
      .rows[0].value,
  ).toEqual({ version: 2, enabled: true });
  await asUser(OWNER, 'service_role');
  const b = (await db.query<any>('select public.create_planner_backup_snapshot() as value')).rows[0]
    .value;
  expect(b.tables.task_change_history.some((x: any) => x.id === event.id)).toBe(true);
});
