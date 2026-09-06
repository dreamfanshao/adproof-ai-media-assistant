-- User feedback and bug reports. Rows are private to their submitting account.
create table public.feedback_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('bug', 'suggestion', 'question', 'other')),
  title text not null check (char_length(title) between 1 and 160),
  description text not null check (char_length(description) between 1 and 5000),
  page_path text check (page_path is null or char_length(page_path) <= 500),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  admin_reply text check (admin_reply is null or char_length(admin_reply) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index feedback_tickets_user_created_idx
  on public.feedback_tickets (user_id, created_at desc);
create index feedback_tickets_status_created_idx
  on public.feedback_tickets (status, created_at desc);

alter table public.feedback_tickets enable row level security;
grant select, insert (user_id, category, title, description, page_path) on public.feedback_tickets to authenticated;

create policy feedback_tickets_select_own
  on public.feedback_tickets for select to authenticated
  using (user_id = auth.uid());
create policy feedback_tickets_insert_own
  on public.feedback_tickets for insert to authenticated
  with check (user_id = auth.uid());

