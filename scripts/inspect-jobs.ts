import { createWorkerPool } from "../worker/src/xhs-db.js";
const pool = createWorkerPool(process.env as never);
const result = await pool.query(`
  select
    j.id::text,
    j.status,
    j.stage,
    j.progress,
    j.message_code,
    j.error_code,
    j.created_at,
    j.completed_at,
    s.id::text as search_task_id,
    s.query_text,
    s.confirmed_rule,
    s.target_count,
    s.collected_count,
    s.persisted_count,
    s.duplicate_count,
    s.partial_reason,
    s.error_message,
    j.result->>'sourceExhausted' as source_exhausted,
    j.result->'stageCounts' as stage_counts,
    j.result->>'requestCount' as request_count,
    j.result->'requestCountByEndpoint' as requests_by_endpoint,
    j.result->'keywordFailures' as keyword_failures
    ,j.result->'searchKeywords' as search_keywords
    ,j.result->'runtimeDiagnostics' as runtime_diagnostics
    ,(
      select jsonb_agg(item)
      from (
        select rejection
        from jsonb_array_elements(coalesce(j.result->'rejections', '[]'::jsonb)) rejection
        where rejection->>'reason' in ('FOLLOWERS_BELOW_MIN', 'FOLLOWERS_ABOVE_MAX', 'FOLLOWERS_MISSING')
        limit 12
      ) item
    ) as follower_rejection_samples
  from private.jobs j
  join public.search_tasks s on s.task_id = j.id
  where j.type = 'creator_search'
  order by j.created_at desc
  limit 5
`);
console.log(JSON.stringify(result.rows, null, 2));
await pool.end();
