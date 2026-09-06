import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createWorkerPool, type SearchJob } from "../worker/src/xhs-db.js";
import { runCreatorSearchJob } from "../worker/src/xhs-search-executor.js";
import { parseSearchRuleHeuristic } from "../server/src/services/rule-parser.js";

const env = process.env;
const client = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const pool = createWorkerPool(env as never);
const { data: sessions, error: sessionError } = await client.from("platform_sessions").select("user_id").eq("status", "connected").limit(1);
if (sessionError) throw sessionError;
let userId = sessions?.[0]?.user_id as string | undefined;
if (!userId) {
  const users = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
  userId = users.data.users[0]?.id;
}
if (!userId) { await pool.end(); throw new Error("no test user available"); }const smokeQuery = process.env.SMOKE_QUERY ?? "粉丝小于1500，做过光子嫩肤的活跃小红书素人";
const projectId = randomUUID();
const taskId = randomUUID();
const jobId = randomUUID();
const idem = randomUUID();
try {
  const project = await client.from("projects").insert({ id: projectId, user_id: userId, idempotency_key: idem, name: "creator-smoke-20260828", product_name: "医美素人测试" });
  if (project.error) throw project.error;
  const payload = {
    search_task_id: taskId, project_id: projectId, keyword: "\u5149\u5b50\u5ae9\u80a4",
    query_text: smokeQuery, target_count: 2,
    confirmed_rule: parseSearchRuleHeuristic(smokeQuery, 2),
    platforms: ["xiaohongshu"],
  };
  const jobInsert = await pool.query("insert into private.jobs (id,user_id,type,status,stage,payload,idempotency_scope,idempotency_key,run_after) values ($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '10 minutes')", [jobId, userId, "creator_search", "queued", "queued", payload, "creator_search", idem]);
  if (jobInsert.rowCount !== 1) throw new Error("job insert failed");
  const task = await client.from("search_tasks").insert({ id: taskId, task_id: jobId, user_id: userId, project_id: projectId, idempotency_key: randomUUID(), query_text: payload.query_text, confirmed_rule: payload.confirmed_rule, target_count: 2 });
  if (task.error) throw task.error;
  const claimedRow = await pool.query("select * from private.jobs where id=$1", [jobId]);
  if (claimedRow.rowCount !== 1) throw new Error("target job claim failed");
  const row = claimedRow.rows[0] as Record<string, any>;
  const job: SearchJob = { id: row.id, task_id: row.task_id, user_id: row.user_id, type: row.type, status: row.status, stage: row.stage, terminal: row.terminal, progress: row.progress, payload: row.payload, result: row.result ?? null, attempts: row.attempts, max_attempts: row.max_attempts, cancel_requested: row.cancel_requested, error_code: row.error_code ?? null, error_message: row.error_message ?? null, retryable: row.retryable, retry_after_seconds: row.retry_after_seconds ?? null };
  console.log("RUNNING_TARGET_JOB", job.id.slice(0, 8));
  await runCreatorSearchJob(env as never, client, pool, job);
  const taskView = await client.from("search_tasks").select("status,terminal,progress,collected_count,persisted_count,duplicate_count,error_code,error_message,partial_reason").eq("id", taskId).single();
  const links = await client.from("project_creators").select("followers,activity_score,match_score,evidence_summary,creators(nickname,platform_creator_id)").eq("project_id", projectId);
  const result = { task: taskView.data, taskError: taskView.error?.message ?? null, creatorCount: links.data?.length ?? 0, creators: (links.data ?? []).map((x: any) => ({ nickname: x.creators?.nickname, followers: x.followers, activity: x.activity_score, match: x.match_score, evidence: x.evidence_summary })) };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await client.from("project_creators").delete().eq("project_id", projectId);
  await client.from("search_tasks").delete().eq("id", taskId);
  await pool.query("delete from private.jobs where id=$1", [jobId]).catch(() => undefined);
  await client.from("projects").delete().eq("id", projectId);
  await pool.end();
  console.log("CLEANED");
}