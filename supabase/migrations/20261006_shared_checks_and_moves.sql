-- Install after the 20261005 migrations. Transactional and safe to run again.
begin;
alter table public.tasks add column if not exists revision bigint not null default 0;
alter table public.tasks add column if not exists detail_items text[];

-- A binary keeps its original Storage path; authorization uses the attachment's
-- CURRENT workspace. Moving never copies/deletes a binary outside a transaction.
alter table public.task_attachments add column if not exists storage_workspace_id uuid;
update public.task_attachments set storage_workspace_id = workspace_id where storage_workspace_id is null;
alter table public.task_attachments alter column storage_workspace_id set not null;
alter table public.task_attachments drop constraint if exists task_attachments_check;
alter table public.task_attachments drop constraint if exists task_attachment_object_path;
alter table public.task_attachments add constraint task_attachment_object_path
  check(object_path = storage_workspace_id::text || '/' || task_id::text || '/' || id::text);
create or replace function private.attachment_origin() returns trigger language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then new.storage_workspace_id := new.workspace_id;
  elsif new.storage_workspace_id is distinct from old.storage_workspace_id then
    raise exception 'Storage origin is immutable';
  end if;
  return new;
end; $$;
drop trigger if exists attachment_origin on public.task_attachments;
create trigger attachment_origin before insert or update on public.task_attachments
  for each row execute function private.attachment_origin();

alter table public.task_completions drop constraint if exists task_completions_task_id_workspace_id_fkey;
alter table public.task_completions add constraint task_completions_task_id_workspace_id_fkey
  foreign key(task_id,workspace_id) references public.tasks(id,workspace_id) on update cascade on delete cascade;
alter table public.task_notes drop constraint if exists task_notes_task_id_workspace_id_fkey;
alter table public.task_notes add constraint task_notes_task_id_workspace_id_fkey
  foreign key(task_id,workspace_id) references public.tasks(id,workspace_id) on update cascade on delete cascade;
alter table public.task_attachments drop constraint if exists task_attachments_task_id_workspace_id_fkey;
alter table public.task_attachments add constraint task_attachments_task_id_workspace_id_fkey
  foreign key(task_id,workspace_id) references public.tasks(id,workspace_id) on update cascade on delete cascade;
alter table public.task_attachments drop constraint if exists task_attachments_note_id_task_id_workspace_id_fkey;
alter table public.task_attachments add constraint task_attachments_note_id_task_id_workspace_id_fkey
  foreign key(note_id,task_id,workspace_id) references public.task_notes(id,task_id,workspace_id)
  on update cascade on delete cascade;
create or replace function private.touch_task_note() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.body is distinct from old.body then new.updated_at := now(); end if;
  return new;
end; $$;

create table if not exists public.workspace_activity (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision bigint not null default 0,
  request_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.workspace_activity(workspace_id) select id from public.workspaces on conflict do nothing;
alter table public.workspace_activity enable row level security;
revoke all on public.workspace_activity from public,anon,authenticated;
grant select on public.workspace_activity to authenticated;
drop policy if exists activity_read on public.workspace_activity;
create policy activity_read on public.workspace_activity for select to authenticated
  using(private.is_workspace_member(workspace_id));
create or replace function private.notify_workspace_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a uuid; b uuid; s uuid;
begin
  if TG_OP <> 'INSERT' then a := old.workspace_id; end if;
  if TG_OP <> 'DELETE' then b := new.workspace_id; end if;
  -- Consistent order also covers cross-space moves.
  for s in select distinct x from unnest(array[a,b]) x where x is not null order by x loop
    insert into public.workspace_activity(workspace_id,revision,request_id)
      values(s,1,nullif(current_setting('dayly.request_id',true),'')::uuid)
      on conflict(workspace_id) do update set revision = public.workspace_activity.revision + 1,
        request_id = excluded.request_id, updated_at = now();
  end loop;
  return null;
end; $$;
do $$ declare t text; begin
  foreach t in array array['tasks','task_notes','task_attachments'] loop
    execute format('drop trigger if exists dayly_activity on public.%I',t);
    execute format('create trigger dayly_activity after insert or update or delete on public.%I for each row execute function private.notify_workspace_activity()',t);
  end loop;
end; $$;
create or replace function private.task_revision() returns trigger language plpgsql set search_path = '' as $$
begin new.revision := old.revision + 1; return new; end; $$;
drop trigger if exists task_revision on public.tasks;
create trigger task_revision before update on public.tasks for each row execute function private.task_revision();

-- Legacy text / v2 arrays are converted only when an item is changed.
create or replace function private.task_progress(t public.tasks) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb; texts text[]; value text; item jsonb; items jsonb := '[]'; i integer := 0;
  done boolean; checked public.task_completions;
begin
  select * into checked from public.task_completions where task_id = t.id;
  done := found;
  if left(t.details,18) = 'dayly:progress:v1:' then
    begin
      p := substring(t.details from 19)::jsonb;
      if jsonb_typeof(p->'items') = 'array' and jsonb_typeof(p->'completed') = 'boolean'
        and (t.detail_items is null or to_jsonb(t.detail_items) =
          (select coalesce(jsonb_agg(x->>'text'),'[]') from jsonb_array_elements(p->'items') x)) then
        return p;
      end if;
    exception when others then p := null; end;
  end if;
  texts := t.detail_items;
  if texts is null and left(t.details,17) = 'dayly:details:v2:' then
    begin select array_agg(x) into texts from jsonb_array_elements_text(substring(t.details from 18)::jsonb) x;
    exception when others then texts := null; end;
  end if;
  if texts is null then texts := regexp_split_to_array(t.details,E'\r\n|\r|\n'); end if;
  foreach value in array texts loop
    if btrim(value) <> '' then
      item := jsonb_build_object('id',t.id::text || '-detail-' || i,'text',btrim(value),'completed',done,
        'completedBy',checked.completed_by,'completedAt',checked.completed_at);
      items := items || jsonb_build_array(item);
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object('items',items,'completed',done,'completedBy',checked.completed_by,'completedAt',checked.completed_at);
end; $$;

create or replace function private.require_confirmed_member(space uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
    or not private.is_workspace_member(space) then raise exception 'Workspace access denied' using errcode='42501'; end if;
end; $$;

create or replace function public.set_task_completion(p_task_id uuid,p_workspace_id uuid,
  p_completed boolean,p_detail_id text default null,p_request_id uuid default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare t public.tasks; p jsonb; items jsonb := '[]'; item jsonb; matched boolean := false;
  done boolean; stamp timestamptz := clock_timestamp();
begin
  perform private.require_confirmed_member(p_workspace_id);
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Task was moved or deleted'; end if;
  if p_completed is null then raise exception 'Completion is required'; end if;
  p := private.task_progress(t);
  for item in select value from jsonb_array_elements(p->'items') loop
    if p_detail_id is null or item->>'id' = p_detail_id then
      matched := true;
      if (item->>'completed')::boolean is distinct from p_completed then
        item := item || jsonb_build_object('completed',p_completed,'completedBy',case when p_completed then auth.uid() end,
          'completedAt',case when p_completed then stamp end);
      end if;
    end if;
    items := items || jsonb_build_array(item);
  end loop;
  if p_detail_id is not null and not matched then raise exception 'Detail was removed'; end if;
  done := case when jsonb_array_length(items)=0 then p_completed
    else not exists(select 1 from jsonb_array_elements(items) x where not (x->>'completed')::boolean) end;
  if (p->>'completed')::boolean is distinct from done then
    p := p || jsonb_build_object('completedBy',case when done then auth.uid() end,'completedAt',case when done then stamp end);
  end if;
  p := p || jsonb_build_object('items',items,'completed',done);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  update public.tasks set details='dayly:progress:v1:' || p::text,
    detail_items=array(select x->>'text' from jsonb_array_elements(items) x) where id=t.id returning * into t;
  if done then
    insert into public.task_completions(task_id,workspace_id,completed_by,completed_at)
      values(t.id,t.workspace_id,coalesce((p->>'completedBy')::uuid,auth.uid()),coalesce((p->>'completedAt')::timestamptz,stamp))
      on conflict(task_id) do update set completed_by=excluded.completed_by,completed_at=excluded.completed_at;
  else delete from public.task_completions where task_id=t.id; end if;
  return t;
end; $$;

-- Content edits retain the latest server checks by stable detail ID, even when
-- an author submits a form opened before another participant's check.
create or replace function public.update_task_content(p_task_id uuid,p_workspace_id uuid,
  p_title text,p_date date,p_items jsonb,p_request_id uuid default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare t public.tasks; p jsonb; items jsonb := '[]'; item jsonb; previous jsonb; done boolean;
begin
  perform private.require_confirmed_member(p_workspace_id);
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Task was moved or deleted'; end if;
  if t.created_by <> auth.uid() and not private.is_workspace_owner(p_workspace_id) then
    raise exception 'Only the author or workspace owner can edit' using errcode='42501'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or exists(select 1 from jsonb_array_elements(p_items) x
    where jsonb_typeof(x->'id') is distinct from 'string' or coalesce(x->>'id','')='' or
      jsonb_typeof(x->'text') is distinct from 'string' or btrim(x->>'text')='') or
    (select count(*) <> count(distinct x->>'id') from jsonb_array_elements(p_items) x) then
    raise exception 'Invalid detail items'; end if;
  p := private.task_progress(t);
  for item in select value from jsonb_array_elements(p_items) loop
    select x into previous from jsonb_array_elements(p->'items') x where x->>'id'=item->>'id';
    item := jsonb_build_object('id',item->>'id','text',btrim(item->>'text'),'completed',
      coalesce((previous->>'completed')::boolean,false),'completedBy',previous->'completedBy','completedAt',previous->'completedAt');
    items := items || jsonb_build_array(item);
  end loop;
  done := case when jsonb_array_length(items)=0 then (p->>'completed')::boolean
    else not exists(select 1 from jsonb_array_elements(items) x where not (x->>'completed')::boolean) end;
  if (p->>'completed')::boolean is distinct from done then
    p := p || jsonb_build_object('completedBy',case when done then auth.uid() end,'completedAt',case when done then clock_timestamp() end);
  end if;
  p := p || jsonb_build_object('items',items,'completed',done);
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  update public.tasks set title=p_title,date=p_date,details='dayly:progress:v1:' || p::text,
    detail_items=array(select x->>'text' from jsonb_array_elements(items) x) where id=t.id returning * into t;
  if done then
    insert into public.task_completions(task_id,workspace_id,completed_by,completed_at)
      values(t.id,t.workspace_id,coalesce((p->>'completedBy')::uuid,auth.uid()),coalesce((p->>'completedAt')::timestamptz,clock_timestamp()))
      on conflict(task_id) do nothing;
  else delete from public.task_completions where task_id=t.id; end if;
  return t;
end; $$;

create or replace function public.move_task(p_task_id uuid,p_workspace_id uuid,p_target_workspace_id uuid,
  p_request_id uuid default null) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  perform private.require_confirmed_member(p_workspace_id);
  perform private.require_confirmed_member(p_target_workspace_id);
  if p_workspace_id = p_target_workspace_id then raise exception 'Choose another workspace'; end if;
  select * into t from public.tasks where id=p_task_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Task was moved or deleted'; end if;
  if t.created_by <> auth.uid() and not private.is_workspace_owner(p_workspace_id) then
    raise exception 'Only the author or workspace owner can move' using errcode='42501'; end if;
  -- Reserve both activity rows BEFORE cascades, in consistent order.
  insert into public.workspace_activity(workspace_id) values(p_workspace_id),(p_target_workspace_id) on conflict do nothing;
  perform 1 from public.workspace_activity where workspace_id in (p_workspace_id,p_target_workspace_id) order by workspace_id for update;
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  update public.tasks set workspace_id=p_target_workspace_id where id=t.id returning * into t;
  return t;
end; $$;

-- Check-only access cannot edit content. Old full-payload writes cannot overwrite
-- concurrent checks: content changes now use the author-checked RPC above.
revoke update(details,detail_items) on public.tasks from authenticated;
revoke insert,delete on public.task_completions from authenticated;
revoke all on function private.task_progress(public.tasks), private.require_confirmed_member(uuid) from public,anon,authenticated;
revoke all on function public.set_task_completion(uuid,uuid,boolean,text,uuid),
  public.update_task_content(uuid,uuid,text,date,jsonb,uuid), public.move_task(uuid,uuid,uuid,uuid) from public,anon;
grant execute on function public.set_task_completion(uuid,uuid,boolean,text,uuid),
  public.update_task_content(uuid,uuid,text,date,jsonb,uuid), public.move_task(uuid,uuid,uuid,uuid) to authenticated;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_activity') then
    alter publication supabase_realtime add table public.workspace_activity;
  end if;
end; $$;
notify pgrst, 'reload schema';
commit;
