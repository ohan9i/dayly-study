-- Preserve existing approvals and plans; bind verified invitations to account UUIDs.
-- Apply to the existing project after the 20261006 migration, before app deployment.
begin;
alter table public.workspace_members
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Bind only an existing approval whose email matches a currently verified account.
-- Do not infer membership from task authorship or restore revoked approvals.
update public.workspace_members m set user_id = u.id
from auth.users u
where m.user_id is null and m.email = lower(u.email) and u.email_confirmed_at is not null;
create unique index if not exists workspace_members_account
  on public.workspace_members(workspace_id, user_id) where user_id is not null;

create or replace function private.bind_workspace_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare person uuid;
begin
  if TG_OP = 'UPDATE' and old.user_id is not null then
    if new.user_id is distinct from old.user_id or new.workspace_id <> old.workspace_id then
      raise exception 'Revoke the existing invitation before changing its account' using errcode = '42501';
    end if;
    return new;
  end if;
  select id into person from auth.users
  where lower(email) = new.email and email_confirmed_at is not null;
  if new.user_id is not null and new.user_id is distinct from person then
    raise exception 'Invitation account must match its verified email' using errcode = '42501';
  end if;
  new.user_id := person;
  return new;
end;
$$;
revoke all on function private.bind_workspace_invitation() from public, anon, authenticated;
drop trigger if exists workspace_invitation_account on public.workspace_members;
create trigger workspace_invitation_account before insert or update on public.workspace_members
  for each row execute function private.bind_workspace_invitation();

create or replace function private.is_workspace_member(space_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_workspace_owner(space_id) or exists(
    select 1 from public.workspace_members m join auth.users u on m.user_id = u.id
    where m.workspace_id = space_id and u.id = auth.uid()
      and u.email_confirmed_at is not null
  );
$$;
revoke all on function private.is_workspace_member(uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;

-- Existing apps already call this RPC on login. Claim pending invitations only
-- after email verification, without adding a frontend deployment dependency.
create or replace function public.ensure_personal_workspace()
returns uuid language plpgsql security definer set search_path = '' as $$
declare person uuid := auth.uid(); address text; space uuid;
begin
  select lower(email) into address from auth.users
  where id = person and email_confirmed_at is not null;
  if person is null or address is null then
    raise exception 'Confirm your email and sign in first' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(person::text, 0));
  update public.workspace_members set user_id = person
  where user_id is null and email = address;
  select id into space from public.workspaces
  where owner_id = person order by created_at, id limit 1;
  if space is null then
    insert into public.workspaces(owner_id, name) values(person, '나의 공부 공간') returning id into space;
  end if;
  return space;
end;
$$;
revoke all on function public.ensure_personal_workspace() from public, anon;
grant execute on function public.ensure_personal_workspace() to authenticated;
notify pgrst, 'reload schema';
commit;
