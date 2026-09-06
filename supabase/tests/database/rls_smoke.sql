-- AdProof AI remote RLS smoke test.
-- Run only against the disposable medium-ai-dev project.
-- Every seed and assertion is wrapped in one transaction and rolled back.

begin;

-- Create disposable FK principals. handle_new_user() also creates profiles.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls-a@example.invalid', '{}'::jsonb),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'rls-b@example.invalid', '{}'::jsonb);

-- Seed as postgres/service role.
insert into public.projects (id, user_id, idempotency_key, name, product_name)
values
  ('10000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000011', 'A 项目', 'A 产品'),
  ('20000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '20000000-0000-0000-0000-000000000011', 'B 项目', 'B 产品');

insert into public.knowledge_bases (id, user_id, scope, name)
values
  ('10000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'private', 'A 私有库'),
  ('20000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'private', 'B 私有库'),
  ('30000000-0000-0000-0000-000000000002', null, 'public_law', '公共广告法库');

insert into public.knowledge_documents (
  id, task_id, user_id, knowledge_base_id, file_name, storage_path,
  mime_type, size_bytes, checksum_sha256, status
) values (
  '30000000-0000-0000-0000-000000000003', null, null,
  '30000000-0000-0000-0000-000000000002', '广告法.txt', 'system/advertising-law.txt',
  'text/plain', 100, repeat('a', 64), 'ready'
);

insert into public.audit_tasks (id, user_id, idempotency_key, title, body)
values
  ('10000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '10000000-0000-0000-0000-000000000014', 'A 审核', 'A 正文'),
  ('20000000-0000-0000-0000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '20000000-0000-0000-0000-000000000014', 'B 审核', 'B 正文');

insert into private.jobs (
  id, user_id, type, idempotency_scope, idempotency_key
) values (
  '10000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'creator_search', 'smoke', '10000000-0000-0000-0000-000000000015'
);

insert into private.upload_intents (
  id, user_id, kind, storage_path, file_name, mime_type,
  size_bytes, checksum_sha256, expires_at
) values (
  '10000000-0000-0000-0000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'audit_asset',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-0000-0000-000000000006/a.png',
  'a.png', 'image/png', 100, repeat('b', 64), now() + interval '10 minutes'
);

insert into storage.objects (bucket_id, name)
values
  ('audit-assets', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/seed/a.png'),
  ('audit-assets', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/seed/b.png');

-- Test as user A.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  v_count integer;
  v_rows integer;
  v_denied boolean;
begin
  select count(*) into v_count from public.projects;
  if v_count <> 1 then
    raise exception 'RLS failure: user A expected 1 visible project, got %', v_count;
  end if;

  select count(*) into v_count
  from public.projects
  where id = '20000000-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'RLS failure: user A can see user B project';
  end if;

  select count(*) into v_count from public.knowledge_bases where scope = 'private';
  if v_count <> 1 then
    raise exception 'RLS failure: user A expected 1 private KB, got %', v_count;
  end if;

  select count(*) into v_count
  from public.knowledge_bases
  where scope = 'public_law';
  if v_count <> 1 then
    raise exception 'RLS failure: user A cannot see the public law KB';
  end if;

  select count(*) into v_count
  from public.knowledge_documents
  where id = '30000000-0000-0000-0000-000000000003'
    and task_id is null;
  if v_count <> 1 then
    raise exception 'RLS/API-shape failure: public law document with null task_id is not visible';
  end if;

  select count(*) into v_count from public.audit_tasks;
  if v_count <> 1 then
    raise exception 'RLS failure: user A expected 1 visible audit task, got %', v_count;
  end if;

  update public.audit_tasks
  set title = '越权更新'
  where id = '20000000-0000-0000-0000-000000000004';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS failure: user A updated user B audit task';
  end if;

  update public.knowledge_bases
  set name = '篡改公共库'
  where id = '30000000-0000-0000-0000-000000000002';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'RLS failure: authenticated user updated public law KB';
  end if;

  if not public.can_upload_to_storage(
    'audit-assets',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-0000-0000-000000000006/a.png'
  ) then
    raise exception 'Storage failure: valid upload intent was rejected';
  end if;

  if public.can_upload_to_storage('audit-assets', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/unknown/b.png') then
    raise exception 'Storage failure: cross-user or missing upload intent was accepted';
  end if;

  select count(*) into v_count
  from storage.objects
  where bucket_id = 'audit-assets';
  if v_count <> 1 then
    raise exception 'Storage RLS failure: user A expected 1 visible object, got %', v_count;
  end if;

  v_denied := false;
  begin
    perform count(*) from public.platform_sessions;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'permission failure: authenticated can read platform_sessions';
  end if;

  v_denied := false;
  begin
    perform count(*) from private.jobs;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'permission failure: authenticated can read private.jobs';
  end if;

  v_denied := false;
  begin
    insert into public.project_groups (user_id, project_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '20000000-0000-0000-0000-000000000001', '越权分组');
  exception
    when foreign_key_violation or insufficient_privilege or check_violation then
      v_denied := true;
  end;
  if not v_denied then
    raise exception 'tenant failure: user A inserted a group under user B project';
  end if;
end;
$$;

reset role;

-- Test as user B.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.projects;
  if v_count <> 1 then
    raise exception 'RLS failure: user B expected 1 visible project, got %', v_count;
  end if;

  select count(*) into v_count
  from public.projects
  where id = '10000000-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'RLS failure: user B can see user A project';
  end if;

  select count(*) into v_count from public.audit_tasks;
  if v_count <> 1 then
    raise exception 'RLS failure: user B expected 1 visible audit task, got %', v_count;
  end if;

  select count(*) into v_count
  from public.knowledge_bases
  where scope = 'public_law';
  if v_count <> 1 then
    raise exception 'RLS failure: user B cannot see the public law KB';
  end if;

  select count(*) into v_count
  from storage.objects
  where bucket_id = 'audit-assets';
  if v_count <> 1 then
    raise exception 'Storage RLS failure: user B expected 1 visible object, got %', v_count;
  end if;
end;
$$;

reset role;
rollback;


