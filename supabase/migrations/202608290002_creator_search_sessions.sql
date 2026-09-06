-- Persistent search continuation state and cross-task screening history.

create table if not exists public.creator_search_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  search_key text not null check (char_length(search_key) = 64),
  query_text text not null,
  confirmed_rule jsonb not null default '{}'::jsonb,
  keywords jsonb not null default '[]'::jsonb check (jsonb_typeof(keywords) = 'array'),
  cursor_state jsonb not null default '{"nextPageByKeyword":{},"exhaustedKeywords":[],"nextKeywordIndex":0}'::jsonb,
  source_exhausted boolean not null default false,
  legacy_seeded_at timestamptz,
  cycle_started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, search_key),
  unique (id, project_id, user_id),
  foreign key (project_id, user_id) references public.projects(id, user_id) on delete cascade
);

create table if not exists public.creator_search_screenings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  search_task_id uuid,
  creator_platform_id text not null check (char_length(creator_platform_id) between 1 and 200),
  note_key text not null check (char_length(note_key) between 1 and 500),
  note_id text,
  disposition text not null check (disposition in ('accepted', 'project_existing', 'filtered', 'failed')),
  reason_code text not null,
  next_eligible_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, note_key),
  foreign key (session_id, project_id, user_id)
    references public.creator_search_sessions(id, project_id, user_id) on delete cascade,
  foreign key (search_task_id, project_id, user_id)
    references public.search_tasks(id, project_id, user_id) on delete no action deferrable initially deferred
);

create index if not exists creator_search_sessions_project_updated_idx
  on public.creator_search_sessions(project_id, updated_at desc);
create index if not exists creator_search_screenings_session_creator_idx
  on public.creator_search_screenings(session_id, creator_platform_id, next_eligible_at desc);

drop trigger if exists creator_search_sessions_set_updated_at on public.creator_search_sessions;
create trigger creator_search_sessions_set_updated_at
  before update on public.creator_search_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists creator_search_screenings_set_updated_at on public.creator_search_screenings;
create trigger creator_search_screenings_set_updated_at
  before update on public.creator_search_screenings
  for each row execute function public.set_updated_at();

alter table public.creator_search_sessions enable row level security;
alter table public.creator_search_screenings enable row level security;

grant select on public.creator_search_sessions, public.creator_search_screenings to authenticated;

drop policy if exists creator_search_sessions_select_own on public.creator_search_sessions;
create policy creator_search_sessions_select_own
  on public.creator_search_sessions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists creator_search_screenings_select_own on public.creator_search_screenings;
create policy creator_search_screenings_select_own
  on public.creator_search_screenings for select to authenticated
  using (user_id = auth.uid());

comment on table public.creator_search_sessions is
  'Persistent per-project search cursor keyed by normalized query and confirmed rule.';
comment on table public.creator_search_screenings is
  'Notes and creators already screened for a search session; filtered creators cool down before re-evaluation.';
