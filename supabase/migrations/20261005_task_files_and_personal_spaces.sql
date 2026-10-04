-- Dayly v1.2. Existing project upgrade. Paste this entire file into SQL Editor.
-- Safe to run again. Existing tasks, memberships and checks are preserved.
begin;

create or replace function public.ensure_personal_workspace()
returns uuid language plpgsql security definer set search_path = '' as $$
declare person uuid := auth.uid(); space uuid;
begin
  if person is null or not exists (
    select 1 from auth.users where id = person and email_confirmed_at is not null
  ) then raise exception 'Confirm your email and sign in first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(person::text, 0));
  select id into space from public.workspaces where owner_id = person order by created_at, id limit 1;
  if space is null then
    insert into public.workspaces(owner_id, name) values(person, '나의 공부 공간') returning id into space;
  end if;
  return space;
end;
$$;
revoke all on function public.ensure_personal_workspace() from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated;

create table if not exists public.task_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  created_by uuid not null references auth.users(id),
  body text not null default '' check(char_length(body) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, task_id, workspace_id),
  foreign key(task_id, workspace_id) references public.tasks(id, workspace_id) on delete cascade
);
create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  task_id uuid not null,
  note_id uuid,
  created_by uuid not null references auth.users(id),
  filename text not null check(char_length(filename) between 1 and 255),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes between 1 and 10485760),
  object_path text not null unique,
  state text not null default 'pending' check(state in ('pending','ready')),
  created_at timestamptz not null default now(),
  check(object_path = workspace_id::text || '/' || task_id::text || '/' || id::text),
  foreign key(task_id, workspace_id) references public.tasks(id, workspace_id) on delete cascade,
  foreign key(note_id, task_id, workspace_id) references public.task_notes(id, task_id, workspace_id) on delete cascade
);
create index if not exists task_notes_workspace on public.task_notes(workspace_id, task_id);
create index if not exists task_attachments_workspace on public.task_attachments(workspace_id, task_id);

create or replace function private.can_manage_task_file(file_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.task_attachments a join public.tasks t on t.id = a.task_id
    where a.id = file_id and private.is_workspace_member(a.workspace_id)
    and (a.created_by = auth.uid() or t.created_by = auth.uid() or private.is_workspace_owner(a.workspace_id)));
$$;
create or replace function private.can_access_task_object(path text, action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.task_attachments a where a.object_path = path
    and private.is_workspace_member(a.workspace_id) and case action
      when 'read' then a.state = 'ready' or private.can_manage_task_file(a.id)
      when 'upload' then a.created_by = auth.uid() and a.state = 'pending'
      when 'delete' then private.can_manage_task_file(a.id)
      else false end);
$$;
revoke all on function private.can_manage_task_file(uuid), private.can_access_task_object(text, text) from public, anon;
grant execute on function private.can_manage_task_file(uuid), private.can_access_task_object(text, text) to authenticated;

alter table public.task_notes enable row level security;
alter table public.task_attachments enable row level security;
revoke all on public.task_notes, public.task_attachments from public, anon, authenticated;
grant select, insert, delete on public.task_notes, public.task_attachments to authenticated;
grant update(body) on public.task_notes to authenticated;
grant update(state) on public.task_attachments to authenticated;

drop policy if exists notes_read on public.task_notes;
create policy notes_read on public.task_notes for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists notes_add on public.task_notes;
create policy notes_add on public.task_notes for insert to authenticated with check(private.is_workspace_member(workspace_id) and created_by = auth.uid());
drop policy if exists notes_edit on public.task_notes;
create policy notes_edit on public.task_notes for update to authenticated
  using(private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)))
  with check(private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
drop policy if exists notes_remove on public.task_notes;
create policy notes_remove on public.task_notes for delete to authenticated using(private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
drop policy if exists files_read on public.task_attachments;
create policy files_read on public.task_attachments for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists files_add on public.task_attachments;
create policy files_add on public.task_attachments for insert to authenticated with check(
  private.is_workspace_member(workspace_id) and created_by = auth.uid() and state = 'pending'
  and (note_id is null or exists(select 1 from public.task_notes n where n.id = note_id and n.created_by = auth.uid()))
);
drop policy if exists files_edit on public.task_attachments;
create policy files_edit on public.task_attachments for update to authenticated
  using(private.can_manage_task_file(id)) with check(private.can_manage_task_file(id));
drop policy if exists files_remove on public.task_attachments;
create policy files_remove on public.task_attachments for delete to authenticated using(private.can_manage_task_file(id));

create or replace function private.touch_task_note()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists task_note_updated on public.task_notes;
create trigger task_note_updated before update on public.task_notes for each row execute function private.touch_task_note();

-- The SDK deletes the binary through Storage first. Prevent cascades from leaving
-- an untracked object, and prevent marking an unfinished upload as available.
create or replace function private.guard_task_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'DELETE' then
    if exists(select 1 from storage.objects where bucket_id = 'task-files' and name = old.object_path) then
      raise exception 'Remove the file through Storage before deleting its record';
    end if;
    return old;
  end if;
  if new.state = 'ready' and not exists(select 1 from storage.objects where bucket_id = 'task-files' and name = new.object_path) then
    raise exception 'Upload the file before marking it ready';
  end if;
  return new;
end;
$$;
drop trigger if exists task_attachment_guard on public.task_attachments;
create trigger task_attachment_guard before update or delete on public.task_attachments for each row execute function private.guard_task_attachment();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values('task-files','task-files',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists dayly_files_read on storage.objects;
create policy dayly_files_read on storage.objects for select to authenticated using(bucket_id = 'task-files' and private.can_access_task_object(name, 'read'));
drop policy if exists dayly_files_upload on storage.objects;
create policy dayly_files_upload on storage.objects for insert to authenticated with check(bucket_id = 'task-files' and private.can_access_task_object(name, 'upload'));
drop policy if exists dayly_files_delete on storage.objects;
create policy dayly_files_delete on storage.objects for delete to authenticated using(bucket_id = 'task-files' and private.can_access_task_object(name, 'delete'));
notify pgrst, 'reload schema';
commit;
