begin;

create table if not exists public.workspace_bootstrap (
  user_id text primary key,
  seeded_at timestamptz not null default now()
);

create table if not exists public.projects (
  id text primary key,
  user_id text not null,
  name text not null,
  short_code text not null,
  description text not null default '',
  project_type text not null,
  operational_status text not null,
  commercial_status text not null,
  priority integer not null default 3 check (priority between 1 and 5),
  strategic_priority integer not null default 3 check (strategic_priority between 1 and 5),
  target_end_date date,
  current_summary text not null default '',
  next_step_summary text not null default '',
  blocked_reason text,
  accent text not null default 'lime',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  name text not null,
  description text not null default '',
  status text not null default 'pending',
  target_date date,
  completed_at timestamptz,
  position integer not null default 0
);

create table if not exists public.tasks (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  milestone_id text references public.milestones(id) on delete set null,
  parent_task_id text references public.tasks(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'pending',
  priority integer not null default 3 check (priority between 1 and 5),
  urgency integer not null default 3 check (urgency between 1 and 5),
  estimated_minutes integer not null default 30 check (estimated_minutes > 0),
  deadline date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  is_blocked boolean not null default false,
  blocking_reason text,
  source_type text not null default 'manual',
  source_id text,
  ai_generated boolean not null default false,
  approved boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.task_dependencies (
  id text primary key,
  user_id text not null,
  task_id text not null references public.tasks(id) on delete cascade,
  depends_on_task_id text not null references public.tasks(id) on delete cascade,
  dependency_type text not null,
  check (task_id <> depends_on_task_id)
);

create table if not exists public.task_evidence (
  id text primary key,
  user_id text not null,
  task_id text not null references public.tasks(id) on delete cascade,
  source_type text not null,
  source_reference text not null,
  description text not null default ''
);

create table if not exists public.project_financials (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  total_value bigint not null default 0,
  currency text not null default 'COP',
  payment_status text not null default 'not_applicable',
  amount_paid bigint not null default 0,
  amount_pending bigint not null default 0,
  payment_structure text not null default '',
  notes text not null default ''
);

create table if not exists public.project_events (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  event_type text not null,
  title text not null,
  description text not null default '',
  source_type text not null default 'manual',
  source_id text,
  event_date timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_suggestions (
  id text primary key,
  user_id text not null,
  project_id text references public.projects(id) on delete cascade,
  suggestion_type text not null,
  title text not null,
  reason text not null,
  confidence integer not null default 70 check (confidence between 0 and 100),
  evidence text not null default '',
  impact text not null default '',
  status text not null default 'pending',
  payload text not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.inbox_items (
  id text primary key,
  user_id text not null,
  content text not null,
  input_type text not null default 'text',
  detected_project_id text references public.projects(id) on delete set null,
  classification text not null default 'Sin clasificar',
  status text not null default 'unprocessed',
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_blocks (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  task_id text references public.tasks(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'proposed',
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table if not exists public.knowledge_items (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  item_type text not null,
  title text not null,
  summary text not null default '',
  source_reference text,
  storage_key text,
  processing_status text not null default 'ready',
  occurred_at timestamptz not null default now()
);

create table if not exists public.repositories (
  id text primary key,
  user_id text not null,
  project_id text not null references public.projects(id) on delete cascade,
  provider text not null default 'github',
  owner text not null,
  repo text not null,
  default_branch text not null default 'main',
  last_sync timestamptz,
  status text not null default 'disconnected'
);

create index if not exists idx_projects_user_status on public.projects(user_id, operational_status);
create index if not exists idx_milestones_user_project on public.milestones(user_id, project_id);
create index if not exists idx_tasks_user_status_deadline on public.tasks(user_id, status, deadline);
create index if not exists idx_tasks_project_status on public.tasks(project_id, status);
create index if not exists idx_dependencies_user_task on public.task_dependencies(user_id, task_id);
create index if not exists idx_evidence_user_task on public.task_evidence(user_id, task_id);
create index if not exists idx_financials_user_project on public.project_financials(user_id, project_id);
create index if not exists idx_events_user_project_date on public.project_events(user_id, project_id, event_date desc);
create index if not exists idx_suggestions_user_status on public.ai_suggestions(user_id, status);
create index if not exists idx_inbox_user_status on public.inbox_items(user_id, status);
create index if not exists idx_calendar_user_start on public.calendar_blocks(user_id, starts_at);
create index if not exists idx_knowledge_user_project on public.knowledge_items(user_id, project_id);
create index if not exists idx_repositories_user_project on public.repositories(user_id, project_id);

alter table public.workspace_bootstrap enable row level security;
alter table public.projects enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_evidence enable row level security;
alter table public.project_financials enable row level security;
alter table public.project_events enable row level security;
alter table public.ai_suggestions enable row level security;
alter table public.inbox_items enable row level security;
alter table public.calendar_blocks enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.repositories enable row level security;

revoke all on public.workspace_bootstrap, public.projects, public.milestones, public.tasks,
  public.task_dependencies, public.task_evidence, public.project_financials, public.project_events,
  public.ai_suggestions, public.inbox_items, public.calendar_blocks, public.knowledge_items,
  public.repositories from anon, authenticated;
grant all on public.workspace_bootstrap, public.projects, public.milestones, public.tasks,
  public.task_dependencies, public.task_evidence, public.project_financials, public.project_events,
  public.ai_suggestions, public.inbox_items, public.calendar_blocks, public.knowledge_items,
  public.repositories to service_role;

-- Persist a task and its timeline event together in one PostgREST transaction.
create or replace function public.project_os_create_task(p_task jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_task public.tasks;
begin
  if not exists (
    select 1 from public.projects
    where id = p_task->>'project_id' and user_id = p_task->>'user_id'
  ) then
    raise exception 'Project not found' using errcode = '42501';
  end if;

  insert into public.tasks
    select * from jsonb_populate_record(null::public.tasks, p_task)
    returning * into saved_task;

  insert into public.project_events
    (id, user_id, project_id, event_type, title, description, source_type, source_id, event_date, created_at)
    values (gen_random_uuid()::text, saved_task.user_id, saved_task.project_id,
      'task', 'Tarea creada', saved_task.title, 'manual', saved_task.id,
      saved_task.created_at, saved_task.created_at);

  return to_jsonb(saved_task);
end;
$$;
revoke all on function public.project_os_create_task(jsonb) from public, anon, authenticated;
grant execute on function public.project_os_create_task(jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-documents', 'project-documents', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

notify pgrst, 'reload schema';

commit;
