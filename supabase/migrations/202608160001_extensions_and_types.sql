-- AdProof AI / 媒介助手 MVP
-- Migration 001: extensions, schemas and enums

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.platform_kind as enum ('xiaohongshu');
create type public.platform_connection_status as enum (
  'disconnected', 'qr_pending', 'qr_scanned', 'connected',
  'expired', 'restricted', 'failed'
);
create type public.project_status as enum ('active', 'archived');
create type public.creator_decision_status as enum ('pending', 'selected', 'discarded');
create type public.contact_status as enum ('not_contacted', 'contacting', 'cooperated', 'unreachable');
create type public.search_task_status as enum (
  'queued', 'validating_session', 'collecting', 'hard_filtering',
  'analyzing', 'persisting', 'completed', 'partial', 'cancelled',
  'session_expired', 'rate_limited', 'failed'
);
create type public.search_partial_reason as enum (
  'source_exhausted', 'session_expired', 'platform_rate_limited',
  'platform_restricted', 'user_cancelled', 'upstream_error'
);
create type public.knowledge_base_scope as enum ('public_law', 'private');
create type public.knowledge_base_status as enum ('empty', 'processing', 'ready', 'needs_attention', 'failed');
create type public.knowledge_document_status as enum (
  'uploaded', 'parsing', 'chunking', 'embedding', 'validating',
  'ready', 'needs_attention', 'cancelled', 'failed'
);
create type public.audit_status as enum (
  'draft', 'queued', 'validating', 'extracting', 'retrieving',
  'analyzing', 'validating_result', 'completed', 'needs_attention',
  'cancelled', 'failed'
);
create type public.risk_level as enum ('low', 'medium', 'high', 'needs_confirmation');
create type public.asset_extract_status as enum ('pending', 'extracting', 'ready', 'low_confidence', 'failed');

create type private.job_type as enum ('xhs_connect', 'creator_search', 'knowledge_ingest', 'content_audit');
create type private.job_status as enum ('queued', 'running', 'completed', 'partial', 'needs_attention', 'cancelled', 'failed');
create type private.upload_kind as enum ('audit_asset', 'knowledge_document', 'ephemeral_qr');
create type private.upload_status as enum ('pending', 'committed', 'expired');
