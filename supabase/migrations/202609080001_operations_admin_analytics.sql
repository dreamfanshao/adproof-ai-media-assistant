-- Online operations center: server-only administrator access and usage events.
create table if not exists private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  created_at timestamptz not null default now()
);

create table if not exists private.analytics_events (
  id bigint generated always as identity primary key,
  event text not null check (char_length(event) between 1 and 80),
  user_key text,
  module text,
  endpoint text,
  provider text,
  status text,
  duration_ms integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_idx
  on private.analytics_events (created_at desc);
create index if not exists analytics_events_user_created_idx
  on private.analytics_events (user_key, created_at desc)
  where user_key is not null;
create index if not exists analytics_events_event_created_idx
  on private.analytics_events (event, created_at desc);

alter table private.admin_users enable row level security;
alter table private.analytics_events enable row level security;

revoke all on private.admin_users from anon, authenticated;
revoke all on private.analytics_events from anon, authenticated;
grant select on private.admin_users to service_role;
grant insert, select on private.analytics_events to service_role;
grant usage, select on sequence private.analytics_events_id_seq to service_role;
