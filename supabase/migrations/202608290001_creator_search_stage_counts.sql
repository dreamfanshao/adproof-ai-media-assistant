alter table public.search_tasks
  add column if not exists stage_counts jsonb not null default '{
    "notes_collected": 0,
    "creators_discovered": 0,
    "profile_failures": 0,
    "follower_filtered": 0,
    "recent_likes_filtered": 0,
    "semantic_filtered": 0,
    "analysis_errors": 0,
    "existing_duplicates": 0,
    "persisted": 0
  }'::jsonb;

comment on column public.search_tasks.stage_counts is
  'Creator search funnel counters: collected notes, unique creators, filter reasons, analysis errors, duplicates, and persisted results.';
