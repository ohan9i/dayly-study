-- Supersedes blanket retention: members may move and recoverably delete plans.
-- Apply LAST. Repeatable; existing plans are neither deleted nor relocated.
begin;
alter table public.tasks add column if not exists deleted_at timestamptz;
alter table public.tasks add column if not exists deleted_by uuid;

create table if not exists public.task_change_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null, workspace_id uuid not null, target_workspace_id uuid,
  operation text not null, changed_by uuid, actor_role text not null,
  changed_at timestamptz not null default clock_timestamp(), request_id uuid,
  before_record jsonb, after_record jsonb not null
);
create index if not exists task_changes_space on public.task_change_history(workspace_id,changed_at desc);
alter table public.task_change_history enable row level security;
revoke all on public.task_change_history from public,anon,authenticated,service_role;
grant select on public.task_change_history to authenticated;
drop policy if exists task_changes_read on public.task_change_history;
create policy task_changes_read on public.task_change_history for select to authenticated
  using(private.is_workspace_member(workspace_id) or private.is_workspace_member(target_workspace_id));

create or replace function private.retain_planner_record() returns trigger
language plpgsql security definer set search_path='' as $$
declare action text:=coalesce(current_setting('dayly.task_action',true),'');
begin
  if TG_OP in ('DELETE','TRUNCATE') then
    if TG_TABLE_NAME='task_attachments' and TG_OP='DELETE' then
      if old.state='pending' then return old; end if;
    end if;
    raise exception 'Physical deletion is disabled; use the recoverable delete action' using errcode='42501';
  end if;
  if TG_TABLE_NAME='tasks' then
    if TG_OP='INSERT' then
      if new.deleted_at is not null or new.deleted_by is not null then
        raise exception 'New plans must be active' using errcode='42501';
      end if;
      return new;
    end if;
    if new.id is distinct from old.id or new.created_by is distinct from old.created_by then
      raise exception 'Plan identity is immutable' using errcode='42501';
    end if;
    if new.workspace_id is distinct from old.workspace_id then
      if action<>'move' or old.deleted_at is not null then
        raise exception 'Use the approved move action' using errcode='42501';
      end if;
      perform private.require_confirmed_member(old.workspace_id);
      perform private.require_confirmed_member(new.workspace_id);
    end if;
    if new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by then
      if action not in ('archive','restore') then
        raise exception 'Use the recoverable delete or restore action' using errcode='42501';
      end if;
      perform private.require_confirmed_member(old.workspace_id);
    elsif old.deleted_at is not null then
      raise exception 'Restore the plan before changing it' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='task_attachments' then
    if old.state='ready' and to_jsonb(new) is distinct from to_jsonb(old) then
      if action<>'move' or (to_jsonb(new)-'workspace_id') is distinct from (to_jsonb(old)-'workspace_id') then
        raise exception 'Saved attachment originals must be preserved' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists dayly_retain_plan on public.tasks;
create trigger dayly_retain_plan before insert or update or delete on public.tasks
  for each row execute function private.retain_planner_record();

drop policy if exists tasks_read on public.tasks;
create policy tasks_read on public.tasks for select to authenticated
  using(deleted_at is null and private.is_workspace_member(workspace_id));

create or replace function private.capture_task_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare action text;
begin
  if TG_OP='INSERT' then
    action:=case when current_setting('dayly.task_action',true)='restore' then 'restore' else 'create' end;
  elsif old.deleted_at is null and new.deleted_at is not null then action:='archive';
  elsif old.deleted_at is not null and new.deleted_at is null then action:='restore';
  elsif old.workspace_id<>new.workspace_id then action:='move';
  elsif old.date<>new.date then action:='date_change';
  else action:='update'; end if;
  insert into public.task_change_history(task_id,workspace_id,target_workspace_id,operation,
    changed_by,actor_role,request_id,before_record,after_record)
  values(new.id,case when TG_OP='INSERT' then new.workspace_id else old.workspace_id end,
    new.workspace_id,action,auth.uid(),coalesce(nullif(current_setting('role',true),'none'),session_user),
    nullif(current_setting('dayly.request_id',true),'')::uuid,
    case when TG_OP='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
  return null;
end; $$;
revoke all on function private.capture_task_change() from public,anon,authenticated,service_role;
drop trigger if exists dayly_task_changes on public.tasks;
create trigger dayly_task_changes after insert or update on public.tasks
  for each row execute function private.capture_task_change();

create or replace function public.archive_task(p_task_id uuid,p_workspace_id uuid,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.tasks; payload jsonb;
begin
  perform private.require_confirmed_member(p_workspace_id);
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Plan is unavailable'; end if;
  if t.deleted_at is not null then return t.id; end if;
  payload:=private.task_snapshot(t.id);
  perform set_config('dayly.task_action','archive',true);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  insert into public.task_deletion_history(workspace_id,task_id,entity_id,entity_type,task_title,
    task_created_by,record_created_by,deleted_by,actor_role,snapshot)
  values(t.workspace_id,t.id,t.id,'task',t.title,t.created_by,t.created_by,auth.uid(),
    coalesce(nullif(current_setting('role',true),'none'),session_user),payload);
  update public.tasks set deleted_at=clock_timestamp(),deleted_by=auth.uid() where id=t.id;
  return t.id;
end; $$;

create or replace function public.prepare_task_deletion(p_task_id uuid,p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks; operation uuid;
begin
  perform private.require_confirmed_member(p_workspace_id);
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id and deleted_at is null for update;
  if not found then raise exception 'Plan is unavailable'; end if;
  insert into private.task_deletion_preparations(workspace_id,task_id,requested_by,snapshot)
    values(t.workspace_id,t.id,auth.uid(),private.task_snapshot(t.id)) returning id into operation;
  -- Old clients must not remove any original bytes before archiving the plan.
  return jsonb_build_object('operation_id',operation,'attachments','[]'::jsonb);
end; $$;
create or replace function public.delete_task_with_history(p_operation_id uuid,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prepared private.task_deletion_preparations; t public.tasks;
begin
  select * into prepared from private.task_deletion_preparations
    where id=p_operation_id and requested_by=auth.uid() for update;
  if not found then raise exception 'Deletion preparation is unavailable' using errcode='42501'; end if;
  perform private.require_confirmed_member(prepared.workspace_id);
  select * into t from public.tasks where id=prepared.task_id and workspace_id=prepared.workspace_id for update;
  if not found then raise exception 'Plan is unavailable'; end if;
  if t.deleted_at is null and t.revision<>(prepared.snapshot->'task'->>'revision')::bigint then
    raise exception 'The plan changed; refresh before deleting' using errcode='40001';
  end if;
  perform public.archive_task(t.id,t.workspace_id,p_request_id);
  delete from private.task_deletion_preparations where id=prepared.id;
  return t.id;
end; $$;

create or replace function public.move_task(p_task_id uuid,p_workspace_id uuid,p_target_workspace_id uuid,p_request_id uuid default null) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare t public.tasks;
begin
  perform private.require_confirmed_member(p_workspace_id);
  perform private.require_confirmed_member(p_target_workspace_id);
  if p_workspace_id=p_target_workspace_id then raise exception 'Choose another workspace'; end if;
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id and deleted_at is null for update;
  if not found then raise exception 'Plan is unavailable'; end if;
  insert into public.workspace_activity(workspace_id) values(p_workspace_id),(p_target_workspace_id) on conflict do nothing;
  perform 1 from public.workspace_activity where workspace_id in (p_workspace_id,p_target_workspace_id) order by workspace_id for update;
  perform set_config('dayly.task_action','move',true);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  update public.tasks set workspace_id=p_target_workspace_id where id=t.id returning * into t;
  return t;
end; $$;

create or replace function public.get_deleted_tasks(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  return coalesce((select jsonb_agg(x order by x.deleted_at desc) from (
    select t.id,t.title,t.date,t.deleted_at,t.deleted_by from public.tasks t
      where t.workspace_id=p_workspace_id and t.deleted_at is not null
    union all
    select h.task_id,h.task_title,(h.snapshot->'task'->>'date')::date,h.deleted_at,h.deleted_by from (
      select distinct on(h.task_id) h.* from public.task_deletion_history h
      where h.workspace_id=p_workspace_id and h.entity_type='task'
      and not exists(select 1 from public.tasks t where t.id=h.task_id)
      order by h.task_id,h.deleted_at desc,h.id desc
    ) h
  ) x),'[]'::jsonb);
end; $$;

create or replace function public.restore_task(p_task_id uuid,p_workspace_id uuid,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.tasks; h public.task_deletion_history; row_data jsonb;
begin
  perform private.require_confirmed_member(p_workspace_id);
  perform pg_advisory_xact_lock(hashtextextended(p_task_id::text,0));
  select * into t from public.tasks where id=p_task_id for update;
  if found then
    if t.workspace_id<>p_workspace_id then raise exception 'Plan is in another workspace'; end if;
    if t.deleted_at is null then return t.id; end if;
    perform set_config('dayly.task_action','restore',true);
    perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
    update public.tasks set deleted_at=null,deleted_by=null where id=t.id;
    return t.id;
  end if;
  select * into h from public.task_deletion_history where task_id=p_task_id and workspace_id=p_workspace_id
    and entity_type='task' order by deleted_at desc,id desc limit 1;
  if not found or h.snapshot->'task' is null then raise exception 'No recovery snapshot exists'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(h.snapshot->'attachments','[]'::jsonb)) a
    where a->>'state'='ready' and not exists(select 1 from storage.objects o where o.bucket_id='task-files' and o.name=a->>'object_path')) then
    raise exception 'Original files are missing; restore the encrypted backup first';
  end if;
  perform set_config('dayly.task_action','restore',true);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  insert into public.tasks select (jsonb_populate_record(null::public.tasks,
    (h.snapshot->'task')||jsonb_build_object('deleted_at',null,'deleted_by',null))).*;
  for row_data in select value from jsonb_array_elements(coalesce(h.snapshot->'notes','[]'::jsonb)) loop
    insert into public.task_notes select (jsonb_populate_record(null::public.task_notes,row_data)).*;
  end loop;
  for row_data in select value from jsonb_array_elements(coalesce(h.snapshot->'attachments','[]'::jsonb)) loop
    insert into public.task_attachments select (jsonb_populate_record(null::public.task_attachments,row_data)).*;
  end loop;
  if h.snapshot->'completion' is not null and h.snapshot->'completion'<>'null'::jsonb then
    insert into public.task_completions select (jsonb_populate_record(null::public.task_completions,h.snapshot->'completion')).*;
  end if;
  return p_task_id;
end; $$;

create or replace function public.get_planner_retention_status(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  return jsonb_build_object('version',2,'enabled',(
    select count(*)=10 from pg_catalog.pg_trigger where tgenabled in ('O','A') and (
      (tgrelid='public.tasks'::regclass and tgname in ('dayly_retain_plan','dayly_retain_truncate','dayly_task_changes')) or
      (tgrelid='public.task_notes'::regclass and tgname in ('dayly_retain_note','dayly_retain_truncate')) or
      (tgrelid='public.task_attachments'::regclass and tgname in ('dayly_retain_attachment','dayly_retain_truncate')) or
      (tgrelid='public.workspaces'::regclass and tgname in ('dayly_retain_workspace','dayly_retain_truncate')) or
      (tgrelid='storage.objects'::regclass and tgname='dayly_retain_file')
    )));
end; $$;
revoke all on function public.archive_task(uuid,uuid,uuid),public.get_deleted_tasks(uuid),public.restore_task(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.archive_task(uuid,uuid,uuid),public.get_deleted_tasks(uuid),public.restore_task(uuid,uuid,uuid) to authenticated;

-- Include the new movement/date history in the already encrypted server export.
-- Keep the original snapshot implementation and extend its result atomically.
do $$ begin
  if to_regprocedure('private.create_planner_backup_snapshot_v1()') is null then
    alter function public.create_planner_backup_snapshot() set schema private;
    alter function private.create_planner_backup_snapshot() rename to create_planner_backup_snapshot_v1;
  end if;
end; $$;
revoke all on function private.create_planner_backup_snapshot_v1() from public,anon,authenticated,service_role;
create or replace function public.create_planner_backup_snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server backup credentials required' using errcode='42501'; end if;
  payload:=private.create_planner_backup_snapshot_v1();
  return jsonb_set(payload,'{tables,task_change_history}',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_change_history x),'[]'::jsonb));
end; $$;
revoke all on function public.create_planner_backup_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.create_planner_backup_snapshot() to service_role;
notify pgrst,'reload schema';
commit;
