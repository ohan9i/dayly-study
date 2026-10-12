-- Read-only incident diagnosis. Run in the affected project's Supabase SQL Editor
-- using an administrator connection. Replace only affected@example.com below.
-- No passwords, tokens, permissions, memberships or records are changed.
begin transaction read only;

-- 1. Identify the actual account UUID and email confirmation status.
select id as user_id, email, email_confirmed_at, created_at
from auth.users
where lower(email) = lower('affected@example.com');

-- 2. Find owned, invited and authored-in spaces, including inaccessible ones.
-- SQL Editor has administrative visibility. This does not itself test a user JWT.
-- expected_access derives the intended policy in this repository; compare with
-- the deployed policy/function definitions in query 4 if results disagree.
with affected as (
  select id, email, email_confirmed_at from auth.users
  where lower(email) = lower('affected@example.com')
)
select u.id as user_id, w.id as workspace_id, w.name, w.owner_id,
  w.owner_id = u.id as is_owner,
  m.email as approved_email,
  (w.owner_id = u.id or (m.id is not null and u.email_confirmed_at is not null))
    as expected_access,
  (select count(*) from public.tasks t where t.workspace_id = w.id) as total_tasks,
  (select count(*) from public.tasks t where t.workspace_id = w.id and t.created_by = u.id)
    as tasks_created_by_user
from affected u
cross join public.workspaces w
left join public.workspace_members m on m.workspace_id = w.id and (
  to_jsonb(m)->>'user_id' = u.id::text
  or (to_jsonb(m)->>'user_id' is null and m.email = lower(u.email))
)
where w.owner_id = u.id or m.id is not null
  or exists(select 1 from public.tasks t where t.workspace_id = w.id and t.created_by = u.id)
order by w.created_at, w.id;

-- 3. Verify required deployment objects without creating or calling write RPCs.
select object_name, to_regclass(object_name) is not null as exists
from (values ('public.workspaces'), ('public.workspace_members'), ('public.tasks'),
  ('public.task_completions'), ('public.task_notes'), ('public.task_attachments'),
  ('public.workspace_activity')) objects(object_name);
select function_name, to_regprocedure(function_name) is not null as exists
from (values ('public.ensure_personal_workspace()'),
  ('private.is_workspace_owner(uuid)'), ('private.is_workspace_member(uuid)'),
  ('private.require_confirmed_member(uuid)'),
  ('public.set_task_completion(uuid,uuid,boolean,text,uuid)'),
  ('public.update_task_content(uuid,uuid,text,date,jsonb,uuid)'),
  ('public.move_task(uuid,uuid,uuid,uuid)')) functions(function_name);

-- 4. Inspect deployed authorization definitions and table-level grants.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public'
and tablename in ('workspaces','workspace_members','tasks','task_completions',
  'task_notes','task_attachments','workspace_activity')
order by tablename, policyname;
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
and p.proname in ('is_workspace_owner','is_workspace_member','require_confirmed_member');
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'authenticated'
and table_name in ('workspaces','workspace_members','tasks','task_completions',
  'task_notes','task_attachments','workspace_activity')
order by table_name, privilege_type;
commit;
