import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';

const OWNER = '10000000-0000-0000-0000-000000000001';
const MEMBER = '10000000-0000-0000-0000-000000000002';
const PENDING = '10000000-0000-0000-0000-000000000003';
const STRANGER = '10000000-0000-0000-0000-000000000004';
const SPACE = '20000000-0000-0000-0000-000000000001';
let db: PGlite;
const migration = readFileSync(
  new URL('../supabase/migrations/20261012_stable_workspace_members.sql', import.meta.url),
  'utf8',
);
async function asUser(id: string) {
  await db.exec('reset role; set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email text unique,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    insert into auth.users values('${OWNER}','owner@example.com',now()),('${MEMBER}','member@example.com',now()),
      ('${PENDING}','pending@example.com',null),('${STRANGER}','stranger@example.com',now());`);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.workspaces(id,owner_id,name) values('${SPACE}','${OWNER}','Shared');
    insert into public.workspace_members(workspace_id,email) values('${SPACE}','member@example.com'),('${SPACE}','pending@example.com');
    insert into public.tasks(workspace_id,created_by,title,date) values('${SPACE}','${MEMBER}','Preserved plan','2026-10-12');`);
  await db.exec(migration);
  await db.exec(migration);
}, 30000);
afterAll(async () => {
  await db?.close();
});

test('upgrade is repeatable and preserves plans and existing approvals', async () => {
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(1);
  expect(
    (await db.query('select email,user_id from public.workspace_members order by email')).rows,
  ).toEqual([
    { email: 'member@example.com', user_id: MEMBER },
    { email: 'pending@example.com', user_id: null },
  ]);
});
test('email change preserves membership and the old email does not give a different account access', async () => {
  await db.exec(`reset role; update auth.users set email='changed@example.com' where id='${MEMBER}';
    update auth.users set email='member@example.com' where id='${STRANGER}';`);
  await asUser(MEMBER);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(1);
  await asUser(STRANGER);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
});
test('pending invitation is claimed on verified login; unverified and anonymous users are rejected', async () => {
  await asUser(PENDING);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
  await expect(db.query('select public.ensure_personal_workspace()')).rejects.toThrow(/Confirm/);
  await db.exec(
    `reset role; update auth.users set email_confirmed_at=now() where id='${PENDING}';`,
  );
  await asUser(PENDING);
  await db.query('select public.ensure_personal_workspace()');
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(1);
  await db.exec('reset role; set role anon');
  await expect(db.query('select public.ensure_personal_workspace()')).rejects.toThrow(
    /permission denied/,
  );
});
test('owners cannot insert a mismatched account ID and editors cannot approve themselves', async () => {
  await asUser(OWNER);
  await expect(
    db.query('insert into public.workspace_members(workspace_id,email,user_id) values($1,$2,$3)', [
      SPACE,
      'unknown@example.com',
      STRANGER,
    ]),
  ).rejects.toThrow(/match its verified email/);
  await asUser(STRANGER);
  await expect(
    db.query('insert into public.workspace_members(workspace_id,email) values($1,$2)', [
      SPACE,
      'member@example.com',
    ]),
  ).rejects.toThrow(/row-level security/);
});
test('revocation removes access without deleting plans and login cannot restore a revoked approval', async () => {
  await asUser(OWNER);
  await db.query('delete from public.workspace_members where workspace_id=$1 and user_id=$2', [
    SPACE,
    MEMBER,
  ]);
  await asUser(MEMBER);
  await db.query('select public.ensure_personal_workspace()');
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(0);
  await asUser(OWNER);
  expect((await db.query('select * from public.tasks')).rows).toHaveLength(1);
});
