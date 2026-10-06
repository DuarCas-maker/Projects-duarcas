begin;

-- Additive migration: preserve all existing rows, RLS and storage settings.
-- Only the server service_role may submit a validated mutation plan.
create or replace function public.project_os_apply_changes(p_user_id text, p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  change jsonb; row_data jsonb; old_row jsonb; table_name text;
  columns_sql text; key_name text; event_id text; child_project text;
begin
  if p_user_id is null or p_user_id = '' or jsonb_typeof(p_changes) <> 'array'
     or jsonb_array_length(p_changes) < 2 or jsonb_array_length(p_changes) > 100 then
    raise exception 'Invalid mutation plan' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id, 0));
  if (select count(*) from jsonb_array_elements(p_changes) c where c->>'table' = 'project_events' and c->>'kind' = 'insert') <> 1 then
    raise exception 'Timeline event required' using errcode = '22023';
  end if;
  select c->'row'->>'id' into event_id from jsonb_array_elements(p_changes) c where c->>'table' = 'project_events';
  if exists (select 1 from public.project_events where id = event_id and user_id = p_user_id) then
    return jsonb_build_object('replayed', true);
  end if;

  for change in select * from jsonb_array_elements(p_changes) loop
    table_name := change->>'table'; row_data := change->'row';
    if table_name not in ('projects', 'milestones', 'tasks', 'task_dependencies', 'project_financials', 'project_events')
       or row_data->>'user_id' is distinct from p_user_id or coalesce(row_data->>'id', '') = '' then
      raise exception 'Invalid mutation target' using errcode = '42501';
    end if;
    for key_name in select jsonb_object_keys(row_data) loop
      if not exists (select 1 from information_schema.columns where table_schema = 'public' and information_schema.columns.table_name = project_os_apply_changes.table_name and column_name = key_name) then
        raise exception 'Invalid column' using errcode = '22023';
      end if;
    end loop;
    execute format('select to_jsonb(t) from public.%I t where id = $1 and user_id = $2', table_name)
      into old_row using row_data->>'id', p_user_id;
    if change->>'kind' <> 'insert' and old_row is null then
      raise exception 'Record changed' using errcode = '23505';
    end if;
    if change ? 'expected' and not (old_row @> (change->'expected')) then
      raise exception 'Record changed' using errcode = '23505';
    end if;
    if table_name in ('milestones', 'tasks', 'project_financials', 'project_events') and not exists (
      select 1 from public.projects where id = row_data->>'project_id' and user_id = p_user_id
    ) then raise exception 'Project not found' using errcode = '42501'; end if;
    if table_name = 'tasks' and row_data->>'milestone_id' is not null and not exists (
      select 1 from public.milestones where id = row_data->>'milestone_id' and user_id = p_user_id and project_id = row_data->>'project_id'
    ) then raise exception 'Milestone not found' using errcode = '42501'; end if;
    if table_name = 'project_financials' then
      if exists (select 1 from public.project_financials where project_id = row_data->>'project_id' and user_id = p_user_id and id <> row_data->>'id') then
        raise exception 'Financial record changed' using errcode = '23505';
      end if;
    end if;
    if table_name = 'task_dependencies' and change->>'kind' = 'insert' then
      select project_id into child_project from public.tasks where id = row_data->>'task_id' and user_id = p_user_id;
      if child_project is null or not exists (select 1 from public.tasks where id = row_data->>'depends_on_task_id' and user_id = p_user_id and project_id = child_project) then
        raise exception 'Dependency not found' using errcode = '42501';
      end if;
      if exists (
        with recursive ancestors(id) as (
          select row_data->>'depends_on_task_id'
          union select d.depends_on_task_id from public.task_dependencies d join ancestors a on d.task_id = a.id where d.user_id = p_user_id
        ) select 1 from ancestors where id = row_data->>'task_id'
      ) then raise exception 'Dependency cycle' using errcode = '23505'; end if;
    end if;

    if change->>'kind' = 'insert' then
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', table_name, table_name) using row_data;
    elsif change->>'kind' = 'update' and table_name <> 'project_events' then
      select string_agg(format('%I', k), ', ' order by k) into columns_sql from jsonb_object_keys(row_data) k where k not in ('id', 'user_id');
      execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2 and user_id = $3', table_name, columns_sql, columns_sql, table_name)
        using row_data, row_data->>'id', p_user_id;
    elsif change->>'kind' = 'delete' and table_name = 'task_dependencies' then
      execute 'delete from public.task_dependencies where id = $1 and user_id = $2' using row_data->>'id', p_user_id;
    else raise exception 'Invalid operation' using errcode = '22023'; end if;
  end loop;

  -- Recheck business invariants under the workspace lock, after edge replacement.
  for change in select * from jsonb_array_elements(p_changes) where value->>'table' = 'tasks' loop
    if change->'row'->>'status' in ('in_progress', 'review', 'completed') and exists (
      select 1 from public.task_dependencies d join public.tasks t on t.id = d.depends_on_task_id
      where d.task_id = change->'row'->>'id' and d.user_id = p_user_id and t.status <> 'completed'
    ) then raise exception 'Unfinished prerequisite' using errcode = '23505'; end if;
    if change->'row'->>'status' not in ('completed', 'cancelled') and exists (
      select 1 from public.milestones where id = change->'row'->>'milestone_id' and user_id = p_user_id and status = 'completed'
    ) then raise exception 'Milestone already completed' using errcode = '23505'; end if;
  end loop;
  for change in select * from jsonb_array_elements(p_changes) where value->>'table' = 'milestones' loop
    if change->'row'->>'status' = 'completed' and exists (
      select 1 from public.tasks where milestone_id = change->'row'->>'id' and user_id = p_user_id and status not in ('completed', 'cancelled')
    ) then raise exception 'Unfinished milestone' using errcode = '23505'; end if;
  end loop;
  return jsonb_build_object('saved', true);
end;
$$;
revoke all on function public.project_os_apply_changes(text, jsonb) from public, anon, authenticated;
grant execute on function public.project_os_apply_changes(text, jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
