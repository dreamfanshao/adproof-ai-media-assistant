-- AdProof AI / 媒介助手 MVP
-- Migration 002: core and private tables

create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform public.platform_kind not null default 'xiaohongshu',
  status public.platform_connection_status not null default 'disconnected',
  encrypted_state bytea,
  encrypted_state_nonce bytea,
  encrypted_state_tag bytea,
  qr_storage_path text,
  qr_expires_at timestamptz,
  session_expires_at timestamptz,
  last_verified_at timestamptz,
  account_display_name text check (account_display_name is null or char_length(account_display_name) <= 200),
  account_handle_masked text check (account_handle_masked is null or char_length(account_handle_masked) <= 200),
  message_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform),
  check (
    (encrypted_state is null and encrypted_state_nonce is null and encrypted_state_tag is null)
    or
    (encrypted_state is not null and encrypted_state_nonce is not null and encrypted_state_tag is not null)
  )
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  name text not null check (char_length(name) between 1 and 100),
  product_name text not null check (char_length(product_name) between 1 and 100),
  description text check (description is null or char_length(description) <= 1000),
  status public.project_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key)
);

create table public.project_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name),
  unique (id, project_id, user_id),
  foreign key (project_id, user_id)
    references public.projects(id, user_id) on delete cascade
);

create table public.search_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  idempotency_key uuid not null,
  query_text text not null check (char_length(query_text) between 3 and 2000),
  confirmed_rule jsonb not null,
  rule_schema_version text not null default 'search-rule.v1',
  model_version text,
  prompt_version text,
  status public.search_task_status not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  terminal boolean not null default false,
  target_count smallint not null default 50 check (target_count between 1 and 50),
  collected_count integer not null default 0 check (collected_count >= 0),
  persisted_count integer not null default 0 check (persisted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  partial_reason public.search_partial_reason,
  can_continue boolean not null default false,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 1),
  message_code text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (id, user_id),
  unique (id, project_id, user_id),
  foreign key (project_id, user_id)
    references public.projects(id, user_id) on delete cascade,
  check ((status = 'partial' and partial_reason is not null) or status <> 'partial')
);

create table public.creators (
  id uuid primary key default gen_random_uuid(),
  platform public.platform_kind not null default 'xiaohongshu',
  platform_creator_id text not null check (char_length(platform_creator_id) between 1 and 200),
  nickname text not null check (char_length(nickname) between 1 and 200),
  handle text check (handle is null or char_length(handle) <= 200),
  profile_url text not null,
  avatar_url text,
  latest_snapshot jsonb not null default '{}'::jsonb,
  latest_captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, platform_creator_id),
  unique (id)
);

create table public.project_creators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  creator_id uuid not null references public.creators(id) on delete restrict,
  search_task_id uuid,
  group_id uuid,
  decision_status public.creator_decision_status not null default 'pending',
  contact_status public.contact_status not null default 'not_contacted',
  followers bigint check (followers is null or followers >= 0),
  posts_last_30d integer check (posts_last_30d is null or posts_last_30d >= 0),
  median_engagement numeric check (median_engagement is null or median_engagement >= 0),
  last_post_at timestamptz,
  activity_score smallint check (activity_score is null or activity_score between 0 and 100),
  match_score smallint check (match_score is null or match_score between 0 and 100),
  data_completeness text not null default 'partial' check (data_completeness in ('complete', 'partial')),
  field_warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(field_warnings) = 'array'),
  evidence_summary text not null default '' check (char_length(evidence_summary) <= 2000),
  analysis_json jsonb not null default '{}'::jsonb,
  discard_reason text check (discard_reason is null or char_length(discard_reason) <= 500),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, creator_id),
  unique (id, user_id),
  foreign key (project_id, user_id)
    references public.projects(id, user_id) on delete cascade,
  foreign key (search_task_id, project_id, user_id)
    references public.search_tasks(id, project_id, user_id)
    on delete no action deferrable initially deferred,
  foreign key (group_id, project_id, user_id)
    references public.project_groups(id, project_id, user_id)
    on delete no action deferrable initially deferred
);

create table public.creator_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_creator_id uuid not null,
  evidence_type text not null check (evidence_type in ('profile', 'post', 'metric', 'ai_analysis')),
  source_url text,
  excerpt text not null check (char_length(excerpt) <= 2000),
  confidence numeric check (confidence is null or confidence between 0 and 1),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (project_creator_id, user_id)
    references public.project_creators(id, user_id) on delete cascade
);

create table public.creator_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_creator_id uuid not null,
  tag text not null check (char_length(tag) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (project_creator_id, tag),
  foreign key (project_creator_id, user_id)
    references public.project_creators(id, user_id) on delete cascade
);

create table public.knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  scope public.knowledge_base_scope not null,
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  status public.knowledge_base_status not null default 'empty',
  version integer not null default 1 check (version >= 1),
  document_count integer not null default 0 check (document_count >= 0),
  ready_document_count integer not null default 0 check (ready_document_count >= 0),
  selectable boolean not null default false,
  source_url text,
  effective_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id),
  check (
    (scope = 'public_law' and user_id is null)
    or
    (scope = 'private' and user_id is not null)
  ),
  check (ready_document_count <= document_count),
  check (selectable = false or ready_document_count > 0)
);

create unique index knowledge_bases_one_public_law_idx
  on public.knowledge_bases (scope)
  where scope = 'public_law';

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  task_id uuid unique,
  user_id uuid references auth.users(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  file_name text not null check (char_length(file_name) between 1 and 255),
  storage_path text not null,
  mime_type text not null check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-fA-F0-9]{64}$'),
  status public.knowledge_document_status not null default 'uploaded',
  version integer not null default 1 check (version >= 1),
  chunk_count integer check (chunk_count is null or chunk_count >= 0),
  page_count integer check (page_count is null or page_count >= 0),
  message_code text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (knowledge_base_id, checksum_sha256),
  unique (id, user_id),
  check ((user_id is null and task_id is null) or (user_id is not null and task_id is not null))
);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
  document_id uuid not null references public.knowledge_documents(id) on delete cascade,
  document_version integer not null check (document_version >= 1),
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  source_locator text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector,
  created_at timestamptz not null default now(),
  unique (document_id, document_version, chunk_index)
);

create table public.audit_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid unique,
  parent_audit_task_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  task_name text check (task_name is null or char_length(task_name) <= 100),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  requirements text check (requirements is null or char_length(requirements) <= 5000),
  private_knowledge_base_ids uuid[] not null default '{}'::uuid[]
    check (cardinality(private_knowledge_base_ids) <= 10),
  status public.audit_status not null default 'draft',
  progress smallint not null default 0 check (progress between 0 and 100),
  message_code text,
  overall_risk public.risk_level,
  risk_counts jsonb,
  recommended_action text,
  result_schema_version text,
  error_code text,
  error_message text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (id, user_id),
  check ((status = 'draft' and task_id is null) or status <> 'draft'),
  check ((status <> 'draft' and task_id is not null) or status = 'draft')
);

create table public.audit_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audit_task_id uuid not null,
  storage_path text not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-fA-F0-9]{64}$'),
  sort_order smallint not null check (sort_order between 0 and 8),
  extract_status public.asset_extract_status not null default 'pending',
  extracted_text text,
  extraction_confidence numeric check (extraction_confidence is null or extraction_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_task_id, sort_order),
  foreign key (audit_task_id, user_id)
    references public.audit_tasks(id, user_id) on delete cascade
);

create table public.audit_knowledge_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audit_task_id uuid not null,
  knowledge_base_id uuid not null,
  scope public.knowledge_base_scope not null,
  name text not null,
  knowledge_base_version integer not null check (knowledge_base_version >= 1),
  document_versions jsonb not null default '[]'::jsonb check (jsonb_typeof(document_versions) = 'array'),
  created_at timestamptz not null default now(),
  unique (audit_task_id, knowledge_base_id),
  foreign key (audit_task_id, user_id)
    references public.audit_tasks(id, user_id) on delete cascade
);

create table public.audit_findings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audit_task_id uuid not null,
  risk_level public.risk_level not null,
  category text not null check (char_length(category) <= 100),
  location jsonb not null,
  source_scope public.knowledge_base_scope not null,
  knowledge_base_id uuid not null,
  knowledge_base_version integer not null check (knowledge_base_version >= 1),
  document_id uuid not null,
  document_version integer not null check (document_version >= 1),
  chunk_id uuid not null,
  source_document text not null,
  source_locator text not null,
  source_excerpt text not null check (char_length(source_excerpt) <= 2000),
  source_url text,
  explanation text not null check (char_length(explanation) <= 3000),
  suggestion text not null check (char_length(suggestion) <= 3000),
  confidence numeric not null check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  foreign key (audit_task_id, user_id)
    references public.audit_tasks(id, user_id) on delete cascade
);

create table public.audit_coverage_warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audit_task_id uuid not null,
  code text not null check (code in (
    'IMAGE_TEXT_LOW_CONFIDENCE', 'IMAGE_TEXT_EXTRACTION_FAILED',
    'INPUT_TRUNCATED', 'KNOWLEDGE_COVERAGE_LIMITED'
  )),
  message text not null check (char_length(message) <= 500),
  asset_id uuid references public.audit_assets(id) on delete set null,
  location text check (location is null or char_length(location) <= 200),
  created_at timestamptz not null default now(),
  foreign key (audit_task_id, user_id)
    references public.audit_tasks(id, user_id) on delete cascade
);

create table private.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type private.job_type not null,
  status private.job_status not null default 'queued',
  stage text not null default 'queued',
  terminal boolean not null default false,
  progress smallint not null default 0 check (progress between 0 and 100),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  idempotency_scope text not null,
  idempotency_key uuid not null,
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_by text,
  lock_expires_at timestamptz,
  lease_version bigint not null default 0 check (lease_version >= 0),
  cancel_requested boolean not null default false,
  message_code text,
  error_code text,
  error_message text,
  retryable boolean not null default false,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_scope, idempotency_key),
  unique (id, user_id),
  check (terminal = (status in ('completed', 'partial', 'needs_attention', 'cancelled', 'failed'))),
  check (
    (status = 'running' and locked_by is not null and lock_expires_at is not null)
    or
    (status <> 'running' and locked_by is null and lock_expires_at is null)
  ),
  check ((terminal and completed_at is not null) or (not terminal and completed_at is null)),
  check (status <> 'completed' or progress = 100)
);

create table private.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references private.jobs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null check (seq >= 1),
  status private.job_status not null,
  stage text not null,
  terminal boolean not null,
  progress smallint not null check (progress between 0 and 100),
  message_code text not null,
  error_code text,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 1),
  data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  unique (job_id, seq)
);

create table private.upload_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind private.upload_kind not null,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[a-fA-F0-9]{64}$'),
  status private.upload_status not null default 'pending',
  expires_at timestamptz not null,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'committed' and committed_at is not null) or status <> 'committed')
);
