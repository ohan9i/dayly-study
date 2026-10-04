-- Existing v1 projects only. New projects should run schema.sql instead.
-- Accept custom subject names without changing tasks, completion checks, or old journals.
begin;
alter table public.tasks drop constraint if exists tasks_subject_check;
alter table public.tasks alter column subject set default '';
alter table public.tasks add constraint tasks_subject_check
  check (char_length(subject) <= 40 and subject = btrim(subject));
commit;
