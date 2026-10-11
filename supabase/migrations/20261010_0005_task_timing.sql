begin;

-- Bounded, additive Project OS change. Preserve every row, existing deadline,
-- authentication policy, storage object, key and service configuration.
do $$ begin
  if to_regclass('public.tasks') is null
     or to_regprocedure('public.project_os_apply_changes(text,jsonb)') is null
     or to_regclass('public.knowledge_items') is null then
    raise exception 'Project OS schema must already exist';
  end if;
end $$;
alter table public.tasks add column if not exists tentative_delivery_date date;
alter table public.tasks add column if not exists origin_meeting_id text;

comment on column public.tasks.tentative_delivery_date is 'Optional planning estimate, never an overdue deadline or priority signal.';
comment on column public.tasks.origin_meeting_id is 'Original Project OS meeting; owner and project validated by server before writes.';
notify pgrst, 'reload schema';
commit;
