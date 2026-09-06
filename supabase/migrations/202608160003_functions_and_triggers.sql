-- AdProof AI / 媒介助手 MVP
-- Migration 003: functions, ownership guards, triggers and worker helpers

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    '新用户'
  );

  insert into public.user_profiles (user_id, display_name)
  values (new.id, left(v_display_name, 50))
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

alter table public.platform_sessions
  add constraint platform_sessions_job_fk
  foreign key (task_id, user_id)
  references private.jobs(id, user_id)
  on delete no action deferrable initially deferred;

alter table public.search_tasks
  add constraint search_tasks_job_fk
  foreign key (task_id, user_id)
  references private.jobs(id, user_id)
  on delete no action deferrable initially deferred;

alter table public.knowledge_documents
  add constraint knowledge_documents_job_fk
  foreign key (task_id, user_id)
  references private.jobs(id, user_id)
  on delete no action deferrable initially deferred;

alter table public.audit_tasks
  add constraint audit_tasks_job_fk
  foreign key (task_id, user_id)
  references private.jobs(id, user_id)
  on delete no action deferrable initially deferred;

alter table public.audit_tasks
  add constraint audit_tasks_parent_owner_fk
  foreign key (parent_audit_task_id, user_id)
  references public.audit_tasks(id, user_id)
  on delete no action deferrable initially deferred;

create or replace function private.enforce_knowledge_document_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scope public.knowledge_base_scope;
  v_owner uuid;
begin
  select scope, user_id
    into v_scope, v_owner
  from public.knowledge_bases
  where id = new.knowledge_base_id;

  if not found then
    raise exception 'knowledge base not found' using errcode = '23503';
  end if;

  if v_scope = 'public_law' and new.user_id is not null then
    raise exception 'public law document must not have user_id' using errcode = '23514';
  end if;

  if v_scope = 'private' and new.user_id is distinct from v_owner then
    raise exception 'knowledge document owner mismatch' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' and (
    select count(*) from public.knowledge_documents
    where knowledge_base_id = new.knowledge_base_id
  ) >= 20 then
    raise exception 'knowledge base document limit reached' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger knowledge_documents_owner_guard
  before insert or update of user_id, knowledge_base_id
  on public.knowledge_documents
  for each row execute function private.enforce_knowledge_document_owner();

create or replace function private.enforce_knowledge_chunk_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document_user uuid;
  v_document_kb uuid;
begin
  select user_id, knowledge_base_id
    into v_document_user, v_document_kb
  from public.knowledge_documents
  where id = new.document_id;

  if not found then
    raise exception 'knowledge document not found' using errcode = '23503';
  end if;

  if new.user_id is distinct from v_document_user
     or new.knowledge_base_id <> v_document_kb then
    raise exception 'knowledge chunk owner or knowledge base mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger knowledge_chunks_owner_guard
  before insert or update of user_id, knowledge_base_id, document_id
  on public.knowledge_chunks
  for each row execute function private.enforce_knowledge_chunk_owner();

create or replace function private.enforce_audit_snapshot_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_scope public.knowledge_base_scope;
  v_owner uuid;
begin
  select scope, user_id
    into v_scope, v_owner
  from public.knowledge_bases
  where id = new.knowledge_base_id;

  if not found then
    raise exception 'knowledge base not found' using errcode = '23503';
  end if;

  if new.scope <> v_scope then
    raise exception 'knowledge base scope mismatch' using errcode = '23514';
  end if;

  if v_scope = 'private' and new.user_id is distinct from v_owner then
    raise exception 'private knowledge base owner mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger audit_snapshot_owner_guard
  before insert or update of user_id, knowledge_base_id, scope
  on public.audit_knowledge_snapshots
  for each row execute function private.enforce_audit_snapshot_owner();

create or replace function private.reject_audit_snapshot_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit knowledge snapshots cannot be updated' using errcode = '55000';
end;
$$;

create trigger audit_snapshot_immutable_guard
  before update on public.audit_knowledge_snapshots
  for each row execute function private.reject_audit_snapshot_mutation();

create or replace function private.enforce_audit_finding_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.audit_knowledge_snapshots s
    where s.audit_task_id = new.audit_task_id
      and s.user_id = new.user_id
      and s.knowledge_base_id = new.knowledge_base_id
      and s.knowledge_base_version = new.knowledge_base_version
      and s.scope = new.source_scope
      and exists (
        select 1
        from jsonb_array_elements(s.document_versions) dv
        where dv ->> 'document_id' = new.document_id::text
          and dv ->> 'version' ~ '^[0-9]+$'
          and (dv ->> 'version')::integer = new.document_version
      )
  ) then
    raise exception 'finding source is outside audit snapshot' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.knowledge_chunks c
    where c.id = new.chunk_id
      and c.document_id = new.document_id
      and c.document_version = new.document_version
      and c.knowledge_base_id = new.knowledge_base_id
  ) then
    raise exception 'finding chunk source mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger audit_finding_source_guard
  before insert or update of user_id, audit_task_id, source_scope, knowledge_base_id,
    knowledge_base_version, document_id, document_version, chunk_id
  on public.audit_findings
  for each row execute function private.enforce_audit_finding_source();

create or replace function private.enforce_coverage_warning_asset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_id is not null and not exists (
    select 1
    from public.audit_assets a
    where a.id = new.asset_id
      and a.audit_task_id = new.audit_task_id
      and a.user_id = new.user_id
  ) then
    raise exception 'coverage warning asset mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger audit_coverage_warning_asset_guard
  before insert or update of user_id, audit_task_id, asset_id
  on public.audit_coverage_warnings
  for each row execute function private.enforce_coverage_warning_asset();

create or replace function private.enforce_job_event_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.jobs j
    where j.id = new.job_id and j.user_id = new.user_id
  ) then
    raise exception 'job event owner mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger job_events_owner_guard
  before insert or update of job_id, user_id
  on private.job_events
  for each row execute function private.enforce_job_event_owner();

create or replace function private.refresh_knowledge_base_stats(p_knowledge_base_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer;
  v_ready integer;
  v_processing integer;
  v_failed integer;
  v_status public.knowledge_base_status;
begin
  select
    count(*)::integer,
    count(*) filter (where status = 'ready')::integer,
    count(*) filter (where status in ('uploaded', 'parsing', 'chunking', 'embedding', 'validating'))::integer,
    count(*) filter (where status = 'failed')::integer
  into v_total, v_ready, v_processing, v_failed
  from public.knowledge_documents
  where knowledge_base_id = p_knowledge_base_id;

  v_status := case
    when v_total = 0 then 'empty'::public.knowledge_base_status
    when v_ready = v_total then 'ready'::public.knowledge_base_status
    when v_ready > 0 then 'needs_attention'::public.knowledge_base_status
    when v_processing > 0 then 'processing'::public.knowledge_base_status
    when v_failed = v_total then 'failed'::public.knowledge_base_status
    else 'needs_attention'::public.knowledge_base_status
  end;

  update public.knowledge_bases
  set document_count = v_total,
      ready_document_count = v_ready,
      selectable = (v_ready > 0),
      status = v_status,
      updated_at = now()
  where id = p_knowledge_base_id;
end;
$$;

create or replace function private.on_knowledge_document_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.knowledge_bases
    set version = version + 1
    where id = old.knowledge_base_id;
    perform private.refresh_knowledge_base_stats(old.knowledge_base_id);
    return old;
  end if;

  if tg_op = 'INSERT' then
    update public.knowledge_bases
    set version = version + 1
    where id = new.knowledge_base_id;
  elsif old.knowledge_base_id <> new.knowledge_base_id
        or ((old.status = 'ready') is distinct from (new.status = 'ready')) then
    update public.knowledge_bases
    set version = version + 1
    where id in (old.knowledge_base_id, new.knowledge_base_id);
  end if;

  perform private.refresh_knowledge_base_stats(new.knowledge_base_id);
  if tg_op = 'UPDATE' and old.knowledge_base_id <> new.knowledge_base_id then
    perform private.refresh_knowledge_base_stats(old.knowledge_base_id);
  end if;
  return new;
end;
$$;

create trigger knowledge_documents_refresh_kb
  after insert or update of status, knowledge_base_id or delete
  on public.knowledge_documents
  for each row execute function private.on_knowledge_document_changed();

create or replace function private.enforce_audit_task_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from unnest(new.private_knowledge_base_ids) as selected(selected_id)
    left join public.knowledge_bases kb
      on kb.id = selected_id
     and kb.scope = 'private'
     and kb.user_id = new.user_id
    where kb.id is null
  ) then
    raise exception 'audit contains unavailable private knowledge base' using errcode = '23514';
  end if;

  if cardinality(new.private_knowledge_base_ids) <>
     (select count(distinct selected_id) from unnest(new.private_knowledge_base_ids) as selected(selected_id)) then
    raise exception 'audit knowledge base selection contains duplicates' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' and (
    new.task_name is distinct from old.task_name
    or new.title is distinct from old.title
    or new.body is distinct from old.body
    or new.requirements is distinct from old.requirements
    or new.private_knowledge_base_ids is distinct from old.private_knowledge_base_ids
    or new.parent_audit_task_id is distinct from old.parent_audit_task_id
  ) then
    raise exception 'submitted audit input is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger audit_tasks_immutability_guard
  before insert or update on public.audit_tasks
  for each row execute function private.enforce_audit_task_immutability();

create or replace function private.enforce_audit_asset_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.audit_status;
  v_task_id uuid;
begin
  if tg_op = 'DELETE' then
    v_task_id := old.audit_task_id;
  else
    v_task_id := new.audit_task_id;
  end if;
  select status into v_status from public.audit_tasks where id = v_task_id;

  if tg_op in ('INSERT', 'DELETE') and v_status <> 'draft' then
    raise exception 'audit assets can only be added or deleted in draft' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and v_status <> 'draft' and (
    new.storage_path is distinct from old.storage_path
    or new.file_name is distinct from old.file_name
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.sort_order is distinct from old.sort_order
  ) then
    raise exception 'submitted audit asset metadata is immutable' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger audit_assets_mutation_guard
  before insert or update or delete on public.audit_assets
  for each row execute function private.enforce_audit_asset_mutation();

create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();
create trigger platform_sessions_set_updated_at before update on public.platform_sessions
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger project_groups_set_updated_at before update on public.project_groups
  for each row execute function public.set_updated_at();
create trigger search_tasks_set_updated_at before update on public.search_tasks
  for each row execute function public.set_updated_at();
create trigger creators_set_updated_at before update on public.creators
  for each row execute function public.set_updated_at();
create trigger project_creators_set_updated_at before update on public.project_creators
  for each row execute function public.set_updated_at();
create trigger knowledge_bases_set_updated_at before update on public.knowledge_bases
  for each row execute function public.set_updated_at();
create trigger knowledge_documents_set_updated_at before update on public.knowledge_documents
  for each row execute function public.set_updated_at();
create trigger audit_tasks_set_updated_at before update on public.audit_tasks
  for each row execute function public.set_updated_at();
create trigger audit_assets_set_updated_at before update on public.audit_assets
  for each row execute function public.set_updated_at();
create trigger jobs_set_updated_at before update on private.jobs
  for each row execute function public.set_updated_at();

create or replace function public.can_upload_to_storage(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from private.upload_intents ui
      where ui.user_id = auth.uid()
        and ui.storage_path = p_object_name
        and ui.status = 'pending'
        and ui.expires_at > now()
        and (
          (p_bucket_id = 'audit-assets' and ui.kind = 'audit_asset')
          or
          (p_bucket_id = 'knowledge-documents' and ui.kind = 'knowledge_document')
        )
    );
$$;

create or replace function private.claim_jobs(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 60
)
returns setof private.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_worker_id is null or char_length(trim(p_worker_id)) = 0 then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  return query
  with picked as (
    select j.id
    from private.jobs j
    where j.cancel_requested = false
      and j.attempts < j.max_attempts
      and j.run_after <= now()
      and (
        j.status = 'queued'
        or (j.status = 'running' and j.lock_expires_at < now())
      )
    order by j.run_after, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 1), 10))
  )
  update private.jobs j
  set status = 'running',
      locked_by = p_worker_id,
      lock_expires_at = now() + make_interval(
        secs => greatest(15, least(coalesce(p_lease_seconds, 60), 600))
      ),
      lease_version = j.lease_version + 1,
      attempts = j.attempts + 1,
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

create or replace function private.lock_job_for_write(
  p_job_id uuid,
  p_worker_id text,
  p_lease_version bigint
)
returns private.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.jobs;
begin
  select * into v_job
  from private.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'job not found' using errcode = '23503';
  end if;

  if v_job.status <> 'running'
     or v_job.locked_by is distinct from p_worker_id
     or v_job.lease_version <> p_lease_version
     or v_job.lock_expires_at is null
     or v_job.lock_expires_at <= now() then
    raise exception 'stale or invalid job lease' using errcode = '55000';
  end if;

  return v_job;
end;
$$;

create or replace function private.renew_job_lease(
  p_job_id uuid,
  p_worker_id text,
  p_lease_version bigint,
  p_lease_seconds integer default 60
)
returns private.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.jobs;
begin
  select * into v_job
  from private.lock_job_for_write(p_job_id, p_worker_id, p_lease_version);

  update private.jobs
  set lock_expires_at = now() + make_interval(
        secs => greatest(15, least(coalesce(p_lease_seconds, 60), 600))
      ),
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function private.transition_job_and_append_event(
  p_job_id uuid,
  p_worker_id text,
  p_lease_version bigint,
  p_status private.job_status,
  p_stage text,
  p_terminal boolean,
  p_progress smallint,
  p_message_code text,
  p_error_code text default null,
  p_retryable boolean default false,
  p_retry_after_seconds integer default null,
  p_data jsonb default '{}'::jsonb,
  p_result jsonb default null,
  p_run_after timestamptz default null
)
returns private.job_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job private.jobs;
  v_seq integer;
  v_event private.job_events;
begin
  select * into v_job
  from private.lock_job_for_write(p_job_id, p_worker_id, p_lease_version);

  if p_terminal is distinct from (
    p_status in ('completed', 'partial', 'needs_attention', 'cancelled', 'failed')
  ) then
    raise exception 'terminal flag does not match job status' using errcode = '23514';
  end if;

  if p_status = 'completed' and p_progress <> 100 then
    raise exception 'completed job progress must be 100' using errcode = '23514';
  end if;

  if p_status = 'queued' and p_stage <> 'queued' then
    raise exception 'requeued job stage must be queued' using errcode = '23514';
  end if;

  if p_message_code is null or char_length(trim(p_message_code)) = 0 then
    raise exception 'message code is required' using errcode = '22023';
  end if;

  select coalesce(max(seq), 0) + 1 into v_seq
  from private.job_events
  where job_id = p_job_id;

  insert into private.job_events (
    job_id, user_id, seq, status, stage, terminal, progress,
    message_code, error_code, retry_after_seconds, data
  ) values (
    p_job_id, v_job.user_id, v_seq, p_status, p_stage, p_terminal, p_progress,
    p_message_code, p_error_code, p_retry_after_seconds, coalesce(p_data, '{}'::jsonb)
  )
  returning * into v_event;

  update private.jobs
  set status = p_status,
      stage = p_stage,
      terminal = p_terminal,
      progress = p_progress,
      message_code = p_message_code,
      error_code = p_error_code,
      retryable = coalesce(p_retryable, false),
      retry_after_seconds = p_retry_after_seconds,
      result = coalesce(p_result, result),
      run_after = case
        when p_status = 'queued' then coalesce(p_run_after, now())
        else run_after
      end,
      locked_by = case when p_status = 'running' then locked_by else null end,
      lock_expires_at = case when p_status = 'running' then lock_expires_at else null end,
      completed_at = case when p_terminal then now() else null end,
      updated_at = now()
  where id = p_job_id;

  return v_event;
end;
$$;

revoke all on function private.claim_jobs(text, integer, integer) from public, anon, authenticated;
revoke all on function private.lock_job_for_write(uuid, text, bigint) from public, anon, authenticated;
revoke all on function private.renew_job_lease(uuid, text, bigint, integer) from public, anon, authenticated;
revoke all on function private.transition_job_and_append_event(uuid, text, bigint, private.job_status, text, boolean, smallint, text, text, boolean, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function private.claim_jobs(text, integer, integer) to service_role;
grant execute on function private.lock_job_for_write(uuid, text, bigint) to service_role;
grant execute on function private.renew_job_lease(uuid, text, bigint, integer) to service_role;
grant execute on function private.transition_job_and_append_event(uuid, text, bigint, private.job_status, text, boolean, smallint, text, text, boolean, integer, jsonb, jsonb, timestamptz) to service_role;
