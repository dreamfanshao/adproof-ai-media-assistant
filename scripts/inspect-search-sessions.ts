import { createWorkerPool } from "../worker/src/xhs-db.js";

const pool = createWorkerPool(process.env as never);
const result = await pool.query(`
  select
    id::text,
    project_id::text,
    query_text,
    source_exhausted,
    cycle_started_at,
    updated_at,
    jsonb_array_length(coalesce(keywords, '[]'::jsonb)) as keyword_count,
    jsonb_array_length(coalesce(cursor_state->'exhaustedKeywords', '[]'::jsonb)) as exhausted_keyword_count,
    cursor_state
  from public.creator_search_sessions
  order by updated_at desc
  limit 10
`);
console.log(JSON.stringify(result.rows, null, 2));
await pool.end();
