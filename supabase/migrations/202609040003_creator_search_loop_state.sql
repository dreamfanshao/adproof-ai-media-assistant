alter type public.search_partial_reason
  add value if not exists 'loop_limit';

alter table public.search_tasks
  add column if not exists loop_state jsonb not null default '{
    "version": "creator-search-loop-v1",
    "iteration": 0,
    "action": "queued",
    "softened_filters": [],
    "candidate_pool": 0,
    "eligible_candidates": 0,
    "last_observation": null
  }'::jsonb;

comment on column public.search_tasks.loop_state is
  'Persisted bounded Agent Loop state and last observation for creator search refresh/recovery.';
