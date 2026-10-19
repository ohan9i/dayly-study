-- Apply after 20261019_member_task_duplication.sql. Repeatable.
-- Copy authorization is membership, independent of the source author's edit rights.
begin;
create or replace function public.duplicate_task(
  p_task_id uuid, p_workspace_id uuid, p_date date, p_request_id uuid default null
) returns public.tasks
language plpgsql security definer set search_path='' as $$
declare source public.tasks; result public.tasks; progress jsonb; item jsonb;
  items text := ''; texts text[] := '{}';
begin
  perform private.require_confirmed_member(p_workspace_id);
  if p_date is null or p_date < date '0001-01-01' or p_date > date '9999-12-31' then
    raise exception 'Choose a valid copy date' using errcode='22007';
  end if;
  -- Hold the source stable until the insert commits; archived/moved plans cannot
  -- be copied from a stale card. No source record or attachment is updated.
  select * into source from public.tasks
    where id=p_task_id and workspace_id=p_workspace_id and deleted_at is null
    for share;
  if not found then
    raise exception 'Source plan is unavailable; refresh the workspace' using errcode='42501';
  end if;
  progress := private.task_progress(source);
  for item in select value from jsonb_array_elements(progress->'items') loop
    -- Escape each value as JSON but omit structural whitespace. jsonb::text
    -- can push a valid 10,000-character browser payload over the constraint.
    -- Spaces, quotes and escapes inside the user's text remain intact.
    items := items || case when cardinality(texts)>0 then ',' else '' end ||
      '{"id":' || to_json(gen_random_uuid()::text)::text ||
      ',"text":' || to_json(item->>'text')::text || ',"completed":false}';
    texts := array_append(texts,item->>'text');
  end loop;
  perform set_config('dayly.request_id',coalesce(p_request_id::text,''),true);
  insert into public.tasks(workspace_id,created_by,title,date,details,detail_items)
    values(p_workspace_id,auth.uid(),source.title,p_date,
      'dayly:progress:v1:{"items":[' || items || '],"completed":false}', texts)
    returning * into result;
  -- Existing retention, audit and activity triggers run on this single insert.
  return result;
end; $$;
revoke all on function public.duplicate_task(uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.duplicate_task(uuid,uuid,date,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
