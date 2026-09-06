-- AdProof AI / 媒介助手 MVP
-- Migration 005: grants and row-level security

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.user_profiles to authenticated;
grant update (display_name) on public.user_profiles to authenticated;
grant select on public.projects to authenticated;
grant insert (user_id, idempotency_key, name, product_name, description) on public.projects to authenticated;
grant update (name, product_name, description, status) on public.projects to authenticated;
grant select, delete on public.project_groups to authenticated;
grant insert (user_id, project_id, name) on public.project_groups to authenticated;
grant update (name) on public.project_groups to authenticated;
grant select on public.search_tasks to authenticated;
grant select on public.creators to authenticated;
grant select on public.project_creators to authenticated;
grant update (decision_status, group_id, contact_status, discard_reason) on public.project_creators to authenticated;
grant select, delete on public.creator_tags to authenticated;
grant insert (user_id, project_creator_id, tag) on public.creator_tags to authenticated;
grant update (tag) on public.creator_tags to authenticated;
grant select on public.creator_evidence to authenticated;
grant select on public.knowledge_bases to authenticated;
grant insert (user_id, scope, name, description) on public.knowledge_bases to authenticated;
grant update (name, description) on public.knowledge_bases to authenticated;
grant select on public.knowledge_documents to authenticated;
grant select on public.knowledge_chunks to authenticated;
grant select on public.audit_tasks to authenticated;
grant insert (parent_audit_task_id, user_id, idempotency_key, task_name, title, body, requirements, private_knowledge_base_ids)
  on public.audit_tasks to authenticated;
grant update (task_name, title, body, requirements, private_knowledge_base_ids) on public.audit_tasks to authenticated;
grant select on public.audit_assets to authenticated;
grant select on public.audit_knowledge_snapshots to authenticated;
grant select on public.audit_findings to authenticated;
grant select on public.audit_coverage_warnings to authenticated;
grant execute on function public.can_upload_to_storage(text, text) to authenticated;

alter table public.user_profiles enable row level security;
alter table public.platform_sessions enable row level security;
alter table public.projects enable row level security;
alter table public.project_groups enable row level security;
alter table public.search_tasks enable row level security;
alter table public.creators enable row level security;
alter table public.project_creators enable row level security;
alter table public.creator_evidence enable row level security;
alter table public.creator_tags enable row level security;
alter table public.knowledge_bases enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.audit_tasks enable row level security;
alter table public.audit_assets enable row level security;
alter table public.audit_knowledge_snapshots enable row level security;
alter table public.audit_findings enable row level security;
alter table public.audit_coverage_warnings enable row level security;
alter table private.jobs enable row level security;
alter table private.job_events enable row level security;
alter table private.upload_intents enable row level security;

create policy user_profiles_select_own
  on public.user_profiles for select to authenticated
  using (user_id = auth.uid());
create policy user_profiles_update_own
  on public.user_profiles for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No authenticated grants are issued for platform_sessions. Only API/Worker
-- service-role code may read or mutate encrypted platform state.
create policy platform_sessions_service_boundary
  on public.platform_sessions for all to authenticated
  using (false) with check (false);

create policy projects_select_own
  on public.projects for select to authenticated
  using (user_id = auth.uid());
create policy projects_insert_own
  on public.projects for insert to authenticated
  with check (user_id = auth.uid());
create policy projects_update_own
  on public.projects for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy project_groups_select_own
  on public.project_groups for select to authenticated
  using (user_id = auth.uid());
create policy project_groups_insert_own
  on public.project_groups for insert to authenticated
  with check (user_id = auth.uid());
create policy project_groups_update_own
  on public.project_groups for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy project_groups_delete_own
  on public.project_groups for delete to authenticated
  using (user_id = auth.uid());

create policy search_tasks_select_own
  on public.search_tasks for select to authenticated
  using (user_id = auth.uid());

create policy creators_select_attached
  on public.creators for select to authenticated
  using (
    exists (
      select 1
      from public.project_creators pc
      where pc.creator_id = creators.id
        and pc.user_id = auth.uid()
    )
  );

create policy project_creators_select_own
  on public.project_creators for select to authenticated
  using (user_id = auth.uid());
create policy project_creators_update_own
  on public.project_creators for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy creator_evidence_select_own
  on public.creator_evidence for select to authenticated
  using (user_id = auth.uid());

create policy creator_tags_select_own
  on public.creator_tags for select to authenticated
  using (user_id = auth.uid());
create policy creator_tags_insert_own
  on public.creator_tags for insert to authenticated
  with check (user_id = auth.uid());
create policy creator_tags_update_own
  on public.creator_tags for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy creator_tags_delete_own
  on public.creator_tags for delete to authenticated
  using (user_id = auth.uid());

create policy knowledge_bases_select_visible
  on public.knowledge_bases for select to authenticated
  using (scope = 'public_law' or user_id = auth.uid());
create policy knowledge_bases_insert_private
  on public.knowledge_bases for insert to authenticated
  with check (scope = 'private' and user_id = auth.uid());
create policy knowledge_bases_update_private
  on public.knowledge_bases for update to authenticated
  using (scope = 'private' and user_id = auth.uid())
  with check (scope = 'private' and user_id = auth.uid());
create policy knowledge_documents_select_visible
  on public.knowledge_documents for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.knowledge_bases kb
      where kb.id = knowledge_documents.knowledge_base_id
        and kb.scope = 'public_law'
    )
  );
create policy knowledge_chunks_select_visible
  on public.knowledge_chunks for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.knowledge_bases kb
      where kb.id = knowledge_chunks.knowledge_base_id
        and kb.scope = 'public_law'
    )
  );

create policy audit_tasks_select_own
  on public.audit_tasks for select to authenticated
  using (user_id = auth.uid());
create policy audit_tasks_insert_own_draft
  on public.audit_tasks for insert to authenticated
  with check (user_id = auth.uid() and status = 'draft' and task_id is null);
create policy audit_tasks_update_own
  on public.audit_tasks for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy audit_assets_select_own
  on public.audit_assets for select to authenticated
  using (user_id = auth.uid());
create policy audit_snapshots_select_own
  on public.audit_knowledge_snapshots for select to authenticated
  using (user_id = auth.uid());
create policy audit_findings_select_own
  on public.audit_findings for select to authenticated
  using (user_id = auth.uid());
create policy audit_warnings_select_own
  on public.audit_coverage_warnings for select to authenticated
  using (user_id = auth.uid());

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
grant usage on schema private to service_role;
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema private to service_role;

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
