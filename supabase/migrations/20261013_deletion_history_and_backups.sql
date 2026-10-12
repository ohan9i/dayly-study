-- Existing project upgrade. Transactional and repeatable; no existing plans are deleted.
begin;
create table if not exists public.task_deletion_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  entity_id uuid not null,
  entity_type text not null check(entity_type in ('task','note','attachment')),
  task_title text not null,
  task_created_by uuid,
  record_created_by uuid,
  deleted_by uuid,
  actor_role text not null,
  deleted_at timestamptz not null default clock_timestamp(),
  snapshot jsonb not null
);
-- No cascading foreign keys: removing an account/space must not erase its audit.
create index if not exists deletion_history_workspace on public.task_deletion_history(workspace_id,deleted_at desc);
alter table public.task_deletion_history enable row level security;
revoke all on public.task_deletion_history from public,anon,authenticated;
grant select on public.task_deletion_history to authenticated;
drop policy if exists deletion_history_read on public.task_deletion_history;
create policy deletion_history_read on public.task_deletion_history for select to authenticated using(
  private.is_workspace_member(workspace_id) and (
    private.is_workspace_owner(workspace_id) or task_created_by=auth.uid() or record_created_by=auth.uid()
  )
);

create table if not exists private.task_deletion_preparations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, task_id uuid not null, requested_by uuid not null,
  created_at timestamptz not null default now(), snapshot jsonb not null
);
create table if not exists private.planner_backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(), completed_at timestamptz,
  workspace_ids uuid[] not null,
  artifact_id text, archive_sha256 text
);
revoke all on private.task_deletion_preparations,private.planner_backup_runs from public,anon,authenticated,service_role;

create or replace function private.task_snapshot(task uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'task',to_jsonb(t),
    'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from public.task_notes n where n.task_id=t.id),'[]'::jsonb),
    'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.task_attachments a where a.task_id=t.id),'[]'::jsonb),
    'completion',(select to_jsonb(c) from public.task_completions c where c.task_id=t.id)
  ) from public.tasks t where t.id=task;
$$;
revoke all on function private.task_snapshot(uuid) from public,anon,authenticated,service_role;

create or replace function private.capture_planner_deletion() returns trigger
language plpgsql security definer set search_path='' as $$
declare task uuid; author uuid; title text; payload jsonb; prepared jsonb; operation uuid;
begin
  if TG_TABLE_NAME='tasks' then
    task:=old.id; author:=old.created_by; title:=old.title;
    payload:=private.task_snapshot(task);
    operation:=nullif(current_setting('dayly.deletion_operation',true),'')::uuid;
    if operation is not null then
      select snapshot into prepared from private.task_deletion_preparations
      where id=operation and task_id=task and workspace_id=old.workspace_id and requested_by=auth.uid();
      if prepared is not null then
        -- SDK removes file objects before deleting their metadata. Keep the
        -- server-captured list from BEFORE that cleanup in the task's audit.
        payload:=jsonb_set(payload,'{attachments}',prepared->'attachments');
      end if;
    end if;
  else
    task:=old.task_id;
    select t.created_by,t.title into author,title from public.tasks t where t.id=task;
    if not found then
      select task_created_by,task_title into author,title from public.task_deletion_history
      where task_id=task and entity_type='task' order by deleted_at desc limit 1;
    end if;
    payload:=jsonb_build_object('record',to_jsonb(old));
  end if;
  insert into public.task_deletion_history(workspace_id,task_id,entity_id,entity_type,task_title,
    task_created_by,record_created_by,deleted_by,actor_role,snapshot)
  values(old.workspace_id,task,old.id,case TG_TABLE_NAME when 'tasks' then 'task' when 'task_notes' then 'note' else 'attachment' end,
    coalesce(title,'삭제된 계획'),author,old.created_by,auth.uid(),
    coalesce(nullif(current_setting('role',true),'none'),session_user),payload);
  return old;
end;
$$;
revoke all on function private.capture_planner_deletion() from public,anon,authenticated,service_role;
drop trigger if exists dayly_deletion_history on public.tasks;
create trigger dayly_deletion_history before delete on public.tasks for each row execute function private.capture_planner_deletion();
drop trigger if exists dayly_deletion_history on public.task_notes;
create trigger dayly_deletion_history before delete on public.task_notes for each row execute function private.capture_planner_deletion();
drop trigger if exists dayly_deletion_history on public.task_attachments;
create trigger dayly_deletion_history before delete on public.task_attachments for each row execute function private.capture_planner_deletion();

create or replace function public.assert_deletion_audit(p_workspace_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  if (select count(*) from pg_catalog.pg_trigger where tgname='dayly_deletion_history'
      and tgrelid in ('public.tasks'::regclass,'public.task_notes'::regclass,'public.task_attachments'::regclass)
      and tgenabled in ('O','A')) <> 3 then
    raise exception 'Deletion history is not enabled; contact the administrator' using errcode='42501';
  end if;
end;
$$;
create or replace function public.prepare_task_deletion(p_task_id uuid,p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.tasks; operation uuid; payload jsonb;
begin
  perform public.assert_deletion_audit(p_workspace_id);
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id for update;
  if not found or not(t.created_by=auth.uid() or private.is_workspace_owner(p_workspace_id)) then
    raise exception 'Task deletion access denied' using errcode='42501';
  end if;
  payload:=private.task_snapshot(t.id);
  insert into private.task_deletion_preparations(workspace_id,task_id,requested_by,snapshot)
    values(p_workspace_id,t.id,auth.uid(),payload) returning id into operation;
  return jsonb_build_object('operation_id',operation,'attachments',payload->'attachments');
end;
$$;
create or replace function public.delete_task_with_history(p_operation_id uuid,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare prepared private.task_deletion_preparations; t public.tasks;
begin
  select * into prepared from private.task_deletion_preparations
    where id=p_operation_id and requested_by=auth.uid() for update;
  if not found then raise exception 'Deletion preparation is unavailable' using errcode='42501'; end if;
  perform public.assert_deletion_audit(prepared.workspace_id);
  select * into t from public.tasks where id=prepared.task_id and workspace_id=prepared.workspace_id for update;
  if not found or not(t.created_by=auth.uid() or private.is_workspace_owner(prepared.workspace_id)) then
    raise exception 'Task deletion access denied' using errcode='42501';
  end if;
  if t.revision<>(prepared.snapshot->'task'->>'revision')::bigint then
    raise exception 'The plan changed during deletion; refresh before retrying' using errcode='40001';
  end if;
  perform set_config('dayly.deletion_operation',prepared.id::text,true);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  delete from public.tasks where id=t.id and workspace_id=t.workspace_id;
  delete from private.task_deletion_preparations where id=prepared.id;
  return t.id;
end;
$$;
revoke all on function public.assert_deletion_audit(uuid),public.prepare_task_deletion(uuid,uuid),public.delete_task_with_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assert_deletion_audit(uuid),public.prepare_task_deletion(uuid,uuid),public.delete_task_with_history(uuid,uuid) to authenticated;

-- One MVCC snapshot contains planner rows, membership metadata and deletion history.
-- Only the server secret key may export it; it is never callable by a browser key.
create or replace function public.create_planner_backup_snapshot() returns jsonb
language plpgsql security definer set search_path='' as $$
declare payload jsonb; backup_id uuid; spaces uuid[];
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server backup credentials required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dayly.backup',0));
  select coalesce(array_agg(id order by id),array[]::uuid[]) into spaces from public.workspaces;
  insert into private.planner_backup_runs(workspace_ids) values(spaces) returning id into backup_id;
  select jsonb_build_object(
    'format','dayly-server-backup-v1','backup_id',backup_id,'snapshot_at',statement_timestamp(),
    'tables',jsonb_build_object(
      'workspaces',coalesce((select jsonb_agg(to_jsonb(x)) from public.workspaces x),'[]'::jsonb),
      'workspace_members',coalesce((select jsonb_agg(to_jsonb(x)) from public.workspace_members x),'[]'::jsonb),
      'tasks',coalesce((select jsonb_agg(to_jsonb(x)) from public.tasks x),'[]'::jsonb),
      'task_completions',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_completions x),'[]'::jsonb),
      'task_notes',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_notes x),'[]'::jsonb),
      'task_attachments',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_attachments x),'[]'::jsonb),
      'workspace_activity',coalesce((select jsonb_agg(to_jsonb(x)) from public.workspace_activity x),'[]'::jsonb),
      'task_deletion_history',coalesce((select jsonb_agg(to_jsonb(x)) from public.task_deletion_history x),'[]'::jsonb),
      'deletion_preparations',coalesce((select jsonb_agg(to_jsonb(x)) from private.task_deletion_preparations x),'[]'::jsonb)
    )
  ) into payload;
  return payload;
end;
$$;
create or replace function public.complete_planner_backup(p_backup_id uuid,p_artifact_id text,p_archive_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Server backup credentials required' using errcode='42501'; end if;
  if p_artifact_id is null or p_archive_sha256 is null or p_artifact_id !~ '^[0-9]+$' or p_archive_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid backup receipt'; end if;
  update private.planner_backup_runs set completed_at=now(),artifact_id=p_artifact_id,archive_sha256=p_archive_sha256
    where id=p_backup_id and completed_at is null;
  if not found then raise exception 'Backup run not found or already completed'; end if;
end;
$$;
revoke all on function public.create_planner_backup_snapshot(),public.complete_planner_backup(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_planner_backup_snapshot(),public.complete_planner_backup(uuid,text,text) to service_role;

create or replace function public.get_workspace_backup_status(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  return jsonb_build_object('last_completed_at',(
    select max(completed_at) from private.planner_backup_runs where p_workspace_id=any(workspace_ids)
  ));
end;
$$;
revoke all on function public.get_workspace_backup_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_workspace_backup_status(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
