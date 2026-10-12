-- Read-only inspection of the DEPLOYED policies and custom triggers.
-- This identifies possible deletion paths, not past deletion events.
select 'delete policy' as kind,
  tablename || '.' || policyname as object_name,
  qual as definition
from pg_policies
where schemaname = 'public' and tablename in ('tasks', 'workspaces')
  and cmd in ('DELETE', 'ALL')
union all
select 'custom trigger' as kind,
  n.nspname || '.' || c.relname || '.' || t.tgname,
  pg_get_functiondef(t.tgfoid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and (
  (n.nspname = 'public' and c.relname in ('tasks', 'workspaces'))
  or (n.nspname = 'auth' and c.relname in ('users', 'sessions'))
);
