-- AdProof AI / 媒介助手 MVP
-- Migration 004: query and concurrency indexes

create index platform_sessions_user_status_idx
  on public.platform_sessions (user_id, status);

create index projects_user_status_updated_idx
  on public.projects (user_id, status, updated_at desc);

create index project_groups_project_name_idx
  on public.project_groups (project_id, name);

create index search_tasks_project_created_idx
  on public.search_tasks (project_id, created_at desc);
create index search_tasks_user_status_idx
  on public.search_tasks (user_id, status, updated_at desc);
create unique index search_tasks_one_active_per_user_idx
  on public.search_tasks (user_id)
  where status in (
    'queued', 'validating_session', 'collecting',
    'hard_filtering', 'analyzing', 'persisting'
  );

create index creators_platform_captured_idx
  on public.creators (platform, latest_captured_at desc);

create index project_creators_project_status_match_idx
  on public.project_creators (project_id, decision_status, match_score desc nulls last, updated_at desc);
create index project_creators_project_group_idx
  on public.project_creators (project_id, group_id);
create index project_creators_creator_idx
  on public.project_creators (creator_id);

create index creator_evidence_project_creator_idx
  on public.creator_evidence (project_creator_id, captured_at desc);
create index creator_evidence_user_idx on public.creator_evidence (user_id);
create index creator_tags_user_idx on public.creator_tags (user_id);
create unique index creator_tags_case_insensitive_unique_idx
  on public.creator_tags (project_creator_id, lower(tag));

create index knowledge_bases_user_scope_status_idx
  on public.knowledge_bases (user_id, scope, status, updated_at desc);
create index knowledge_documents_kb_status_idx
  on public.knowledge_documents (knowledge_base_id, status, updated_at desc);
create index knowledge_documents_user_idx on public.knowledge_documents (user_id);
create unique index knowledge_documents_one_active_per_user_idx
  on public.knowledge_documents (user_id)
  where user_id is not null
    and status in ('uploaded', 'parsing', 'chunking', 'embedding', 'validating');
create index knowledge_chunks_kb_document_idx
  on public.knowledge_chunks (knowledge_base_id, document_id, document_version, chunk_index);
create index knowledge_chunks_user_idx on public.knowledge_chunks (user_id);

-- Embedding dimension is intentionally not fixed yet. Add an HNSW/IVFFlat index
-- only after the embedding model and vector dimension pass the local Chinese Eval.

create index audit_tasks_user_created_idx
  on public.audit_tasks (user_id, created_at desc);
create index audit_tasks_user_status_risk_idx
  on public.audit_tasks (user_id, status, overall_risk, created_at desc);
create unique index audit_tasks_one_active_per_user_idx
  on public.audit_tasks (user_id)
  where status in (
    'queued', 'validating', 'extracting', 'retrieving',
    'analyzing', 'validating_result'
  );
create index audit_assets_task_order_idx
  on public.audit_assets (audit_task_id, sort_order);
create index audit_assets_user_idx on public.audit_assets (user_id);
create index audit_snapshots_user_idx on public.audit_knowledge_snapshots (user_id);
create index audit_findings_task_risk_idx
  on public.audit_findings (audit_task_id, risk_level);
create index audit_findings_user_idx on public.audit_findings (user_id);
create index audit_warnings_task_idx
  on public.audit_coverage_warnings (audit_task_id);
create index audit_warnings_user_idx on public.audit_coverage_warnings (user_id);

create index jobs_claim_idx
  on private.jobs (run_after, created_at)
  where status in ('queued', 'running') and cancel_requested = false;
create index jobs_user_type_status_idx
  on private.jobs (user_id, type, status, updated_at desc);
create unique index jobs_one_active_knowledge_ingest_per_user_idx
  on private.jobs (user_id)
  where type = 'knowledge_ingest'
    and status in ('queued', 'running');
create index job_events_job_seq_idx
  on private.job_events (job_id, seq);
create index upload_intents_expiry_idx
  on private.upload_intents (status, expires_at);
