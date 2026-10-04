-- Dayly v1. Run once in a NEW Supabase project's SQL Editor.
-- The browser uses only a publishable key; all authorization is enforced here.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null default 'editor' check (role = 'editor'),
  created_at timestamptz not null default now(),
  unique (workspace_id, email)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(btrim(title)) between 1 and 150),
  subject text not null check (subject in ('전공','수학','생활','기록','기타')),
  date date not null,
  time text not null default '' check (time = '' or time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  details text not null default '' check (char_length(details) <= 10000),
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create table public.study_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(btrim(title)) between 1 and 150),
  subject text not null check (subject in ('전공','수학','생활','기록','기타')),
  date date not null,
  content text not null default '' check (char_length(content) <= 10000),
  minutes integer not null default 0 check (minutes between 0 and 1440),
  created_at timestamptz not null default now()
);
create table public.task_completions (
  task_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  completed_by uuid not null references auth.users(id),
  completed_at timestamptz not null default now(),
  foreign key (task_id, workspace_id) references public.tasks(id, workspace_id) on delete cascade
);
create index tasks_workspace_date on public.tasks(workspace_id, date);
create index study_logs_workspace_date on public.study_logs(workspace_id, date);
create index task_completions_workspace on public.task_completions(workspace_id);
create index workspaces_owner on public.workspaces(owner_id);

create function private.is_workspace_owner(space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspaces w where w.id = space_id and w.owner_id = auth.uid());
$$;
create function private.is_workspace_member(space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_workspace_owner(space_id) or exists(
    select 1 from public.workspace_members m join auth.users u
      on m.email = lower(u.email)
    where m.workspace_id = space_id and u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function private.is_workspace_owner(uuid) from public, anon;
revoke all on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_owner(uuid), private.is_workspace_member(uuid) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.tasks enable row level security;
alter table public.study_logs enable row level security;
alter table public.task_completions enable row level security;
revoke all on public.workspaces, public.workspace_members, public.tasks, public.study_logs, public.task_completions from public, anon, authenticated;
grant select, insert on public.workspaces to authenticated;
grant update(name) on public.workspaces to authenticated;
grant select, insert, delete on public.workspace_members to authenticated;
grant select, insert, delete on public.tasks, public.study_logs to authenticated;
grant update(title, subject, date, time, details) on public.tasks to authenticated;
grant update(title, subject, date, content, minutes) on public.study_logs to authenticated;
grant select, insert, delete on public.task_completions to authenticated;

create policy spaces_read on public.workspaces for select to authenticated using (owner_id = auth.uid() or private.is_workspace_member(id));
create policy spaces_create on public.workspaces for insert to authenticated with check (owner_id = auth.uid());
create policy spaces_rename on public.workspaces for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy members_read on public.workspace_members for select to authenticated using (private.is_workspace_owner(workspace_id));
create policy members_add on public.workspace_members for insert to authenticated with check (private.is_workspace_owner(workspace_id));
create policy members_remove on public.workspace_members for delete to authenticated using (private.is_workspace_owner(workspace_id));
create policy tasks_read on public.tasks for select to authenticated using (private.is_workspace_member(workspace_id));
create policy tasks_add on public.tasks for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy tasks_edit on public.tasks for update to authenticated
  using (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)))
  with check (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
create policy tasks_remove on public.tasks for delete to authenticated using (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
create policy logs_read on public.study_logs for select to authenticated using (private.is_workspace_member(workspace_id));
create policy logs_add on public.study_logs for insert to authenticated with check (private.is_workspace_member(workspace_id) and created_by = auth.uid());
create policy logs_edit on public.study_logs for update to authenticated
  using (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)))
  with check (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
create policy logs_remove on public.study_logs for delete to authenticated using (private.is_workspace_member(workspace_id) and (created_by = auth.uid() or private.is_workspace_owner(workspace_id)));
create policy checks_read on public.task_completions for select to authenticated using (private.is_workspace_member(workspace_id));
create policy checks_add on public.task_completions for insert to authenticated with check (private.is_workspace_owner(workspace_id) and completed_by = auth.uid());
create policy checks_remove on public.task_completions for delete to authenticated using (private.is_workspace_owner(workspace_id));
commit;
