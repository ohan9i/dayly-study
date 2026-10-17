-- Apply LAST, after 20261013_deletion_history_and_backups.sql.
-- Repeatable and transactional. Does not delete or relocate existing data.
begin;

-- A trigger also covers old SECURITY DEFINER RPCs and cascading account/space
-- deletions, which ordinary RLS policies alone cannot prevent.
create or replace function private.retain_planner_record() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP in ('DELETE','TRUNCATE') then
    if TG_TABLE_NAME='task_attachments' and TG_OP='DELETE' then
      if old.state='pending' then
        return old; -- Unfinished uploads may still be cleaned up.
      end if;
    end if;
    raise exception 'Saved planner records cannot be deleted' using errcode='42501';
  end if;
  if TG_TABLE_NAME='tasks' then
    if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by then
      raise exception 'Saved plans must remain in their original workspace' using errcode='42501';
    end if;
  elsif TG_TABLE_NAME='task_attachments' then
    if old.state='ready' and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'Saved attachments cannot be replaced or reset' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.retain_planner_record() from public,anon,authenticated,service_role;

drop trigger if exists dayly_retain_plan on public.tasks;
create trigger dayly_retain_plan before delete or update on public.tasks
  for each row execute function private.retain_planner_record();
drop trigger if exists dayly_retain_note on public.task_notes;
create trigger dayly_retain_note before delete on public.task_notes
  for each row execute function private.retain_planner_record();
drop trigger if exists dayly_retain_attachment on public.task_attachments;
create trigger dayly_retain_attachment before delete or update on public.task_attachments
  for each row execute function private.retain_planner_record();
drop trigger if exists dayly_retain_workspace on public.workspaces;
create trigger dayly_retain_workspace before delete on public.workspaces
  for each row execute function private.retain_planner_record();

do $$
declare tbl text;
begin
  foreach tbl in array array['tasks','task_notes','task_attachments','workspaces'] loop
    execute format('drop trigger if exists dayly_retain_truncate on public.%I',tbl);
    execute format('create trigger dayly_retain_truncate before truncate on public.%I for each statement execute function private.retain_planner_record()',tbl);
  end loop;
end;
$$;

revoke delete,truncate on public.tasks,public.task_notes,public.workspaces from anon,authenticated,service_role;
-- Pending attachment DELETE stays available, governed by existing ownership RLS.
drop policy if exists tasks_remove on public.tasks;
drop policy if exists notes_remove on public.task_notes;

-- Deny old clients BEFORE they remove original file bytes. Keep these RPCs as
-- explicit failures rather than letting an old deployment start partial cleanup.
create or replace function public.prepare_task_deletion(p_task_id uuid,p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  raise exception 'Saved planner records cannot be deleted' using errcode='42501';
end;
$$;
create or replace function public.delete_task_with_history(p_operation_id uuid,p_request_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
begin
  raise exception 'Saved planner records cannot be deleted' using errcode='42501';
end;
$$;
create or replace function public.move_task(p_task_id uuid,p_workspace_id uuid,p_target_workspace_id uuid,p_request_id uuid default null) returns public.tasks
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  raise exception 'Saved plans must remain in their original workspace' using errcode='42501';
end;
$$;

-- Restrictive policies compose with existing upload/read/owner policies. A
-- separate guard also covers service-role requests and older definer functions.
create or replace function private.is_retained_task_object(bucket text,path text) returns boolean
language sql stable security definer set search_path='' as $$
  select bucket='task-files' and exists(
    select 1 from public.task_attachments a where a.object_path=path and a.state='ready'
  );
$$;
revoke all on function private.is_retained_task_object(text,text) from public,anon;
grant execute on function private.is_retained_task_object(text,text) to authenticated,service_role;
drop policy if exists dayly_retain_file_delete on storage.objects;
create policy dayly_retain_file_delete on storage.objects as restrictive for delete to authenticated
  using(not private.is_retained_task_object(bucket_id,name));
drop policy if exists dayly_retain_file_update on storage.objects;
create policy dayly_retain_file_update on storage.objects as restrictive for update to authenticated
  using(not private.is_retained_task_object(bucket_id,name));

create or replace function private.retain_planner_object() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if private.is_retained_task_object(old.bucket_id,old.name) then
    raise exception 'Saved attachment originals cannot be deleted or replaced' using errcode='42501';
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.retain_planner_object() from public,anon,authenticated,service_role;
drop trigger if exists dayly_retain_file on storage.objects;
create trigger dayly_retain_file before delete or update of bucket_id,name on storage.objects
  for each row execute function private.retain_planner_object();

create or replace function public.get_planner_retention_status(p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_confirmed_member(p_workspace_id);
  return jsonb_build_object('version',1,'enabled',(
    select count(*)=9 from pg_catalog.pg_trigger
    where tgenabled in ('O','A') and (
      (tgrelid='public.tasks'::regclass and tgname in ('dayly_retain_plan','dayly_retain_truncate')) or
      (tgrelid='public.task_notes'::regclass and tgname in ('dayly_retain_note','dayly_retain_truncate')) or
      (tgrelid='public.task_attachments'::regclass and tgname in ('dayly_retain_attachment','dayly_retain_truncate')) or
      (tgrelid='public.workspaces'::regclass and tgname in ('dayly_retain_workspace','dayly_retain_truncate')) or
      (tgrelid='storage.objects'::regclass and tgname='dayly_retain_file')
    )
  ));
end;
$$;
revoke all on function public.get_planner_retention_status(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_planner_retention_status(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
