-- Add native ordered detail items without removing legacy text/subject/time.
-- Null means "read the legacy details text"; [] explicitly means no items.
-- Existing rows and completion/attachment IDs stay untouched. The application
-- converts a legacy memo when read and fills this column on the next edit.
begin;
alter table public.tasks add column if not exists detail_items text[];
alter table public.tasks drop constraint if exists tasks_detail_items_check;
alter table public.tasks add constraint tasks_detail_items_check check (
  detail_items is null or (
    (cardinality(detail_items) = 0 or array_ndims(detail_items) = 1)
    and array_position(detail_items, null) is null
    and char_length(array_to_json(detail_items)::text) <= 10000
  )
);
grant update(detail_items) on public.tasks to authenticated;
notify pgrst, 'reload schema';
commit;
