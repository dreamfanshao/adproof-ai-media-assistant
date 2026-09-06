-- AdProof AI Job lease/fencing smoke test.
-- Run only against a disposable test project. The transaction is rolled back.

begin;

insert into auth.users (id, email, raw_user_meta_data)
values (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'job-fencing@example.invalid',
  '{}'::jsonb
);

insert into private.jobs (
  id, user_id, type, idempotency_scope, idempotency_key
) values (
  'cccccccc-0000-4000-8000-000000000001',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'creator_search',
  'job-fencing-smoke',
  'cccccccc-0000-4000-8000-000000000002'
);

do $$
declare
  v_job_id constant uuid := 'cccccccc-0000-4000-8000-000000000001';
  v_lease_a bigint;
  v_lease_b bigint;
  v_stale_rejected boolean := false;
  v_count integer;
begin
  perform 1 from private.claim_jobs('worker-a', 1, 15);

  select lease_version into v_lease_a
  from private.jobs
  where id = v_job_id;

  if v_lease_a <> 1 then
    raise exception 'fencing failure: worker-a expected lease 1, got %', v_lease_a;
  end if;

  update private.jobs
  set lock_expires_at = now() - interval '1 second'
  where id = v_job_id;

  perform 1 from private.claim_jobs('worker-b', 1, 60);

  select lease_version into v_lease_b
  from private.jobs
  where id = v_job_id;

  if v_lease_b <> v_lease_a + 1 then
    raise exception 'fencing failure: worker-b did not receive the next lease';
  end if;

  begin
    perform private.lock_job_for_write(v_job_id, 'worker-a', v_lease_a);
  exception when sqlstate '55000' then
    v_stale_rejected := true;
  end;

  if not v_stale_rejected then
    raise exception 'fencing failure: stale worker-a lease was accepted';
  end if;

  perform private.transition_job_and_append_event(
    v_job_id,
    'worker-b',
    v_lease_b,
    'completed'::private.job_status,
    'completed',
    true,
    100::smallint,
    'SEARCH_COMPLETED'
  );

  select count(*) into v_count
  from private.jobs
  where id = v_job_id
    and status = 'completed'
    and stage = 'completed'
    and terminal = true
    and progress = 100
    and locked_by is null
    and lock_expires_at is null
    and completed_at is not null;

  if v_count <> 1 then
    raise exception 'transition failure: completed job state is inconsistent';
  end if;

  select count(*) into v_count
  from private.job_events
  where job_id = v_job_id
    and seq = 1
    and status = 'completed'
    and terminal = true;

  if v_count <> 1 then
    raise exception 'transition failure: expected one atomic completion event';
  end if;
end;
$$;

rollback;
