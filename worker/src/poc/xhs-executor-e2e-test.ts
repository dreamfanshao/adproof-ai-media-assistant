// T07 Phase 1 临时 E2E 测试：直插 fixture → claim → runCreatorSearchJob → 验证落库 → 清理（验证后删除）
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createWorkerClient, createWorkerPool, claimSearchJob, type WorkerEnv } from "../xhs-db.js";
import { runCreatorSearchJob } from "../xhs-search-executor.js";

function loadEnv(): WorkerEnv {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env as unknown as WorkerEnv;
}

const env = loadEnv();
if (!env.DATABASE_URL) throw new Error("DATABASE_URL missing from .env.local（需用户提供数据库密码后写入）");
const client = createWorkerClient(env);
const pool = createWorkerPool(env);

// 取已连接会话的用户作为测试用户
const { data: sessionRows } = await client
  .from("platform_sessions")
  .select("user_id")
  .eq("status", "connected")
  .limit(1);
const userId = sessionRows?.[0]?.user_id;
if (!userId) throw new Error("no connected session user");

const projectId = randomUUID();
const taskId = randomUUID();
const rule = {
  schema_version: "search-rule.v1",
  hard_filters: { followers: { operator: "lt", value: 1_500 } },
  semantic_conditions: [
    { id: "c1", type: "experience", terms: ["光子嫩肤", "医美"], match: "any" },
    { id: "c2", type: "concern", terms: ["雀斑", "晒斑", "斑点"], match: "any" },
  ],
  ranking: [{ field: "match_score", direction: "desc" }],
  limit: 3,
  ambiguities: [],
};

try {
  const { error: projectError } = await client.from("projects").insert({
    id: projectId,
    user_id: userId,
    idempotency_key: randomUUID(),
    name: "T07-E2E-测试项目",
    product_name: "玻尿酸",
  });
  if (projectError) throw new Error(`fixture project: ${projectError.message}`);

  // 先建 private.jobs（search_tasks.task_id 外键引用 jobs.id）
  const jobInsert = await pool.query(
    `insert into private.jobs (user_id, type, status, stage, payload, idempotency_scope, idempotency_key, run_after)
     values ($1, 'creator_search', 'queued', 'queued', $2, 'creator_search', $3, now())
     returning id`,
    [userId, { search_task_id: taskId, project_id: projectId, keyword: "光子嫩肤", target_count: 3, confirmed_rule: rule }, randomUUID()],
  );
  const jobId = jobInsert.rows[0].id as string;

  const { error: taskError } = await client.from("search_tasks").insert({
    id: taskId,
    task_id: jobId,
    user_id: userId,
    project_id: projectId,
    idempotency_key: randomUUID(),
    query_text: "光子嫩肤 素人 测试",
    confirmed_rule: rule,
    target_count: 3,
  });
  if (taskError) throw new Error(`fixture search_task: ${taskError.message}`);

  const job = await claimSearchJob(pool, "e2e-test-worker");
  if (!job) throw new Error("claim failed (no queued job)");
  console.log(`CLAIMED job=${job.id.slice(0, 8)}… task=${taskId.slice(0, 8)}…`);
  await runCreatorSearchJob(env, client, pool, job);

  const task = await client.from("search_tasks").select("status,progress,terminal,collected_count,persisted_count,duplicate_count,partial_reason,message_code").eq("id", taskId).single();
  console.log("TASK=" + JSON.stringify(task.data));
  const links = await client
    .from("project_creators")
    .select("followers,activity_score,match_score,data_completeness,field_warnings,evidence_summary,analysis_json,creators(nickname,platform_creator_id,latest_snapshot)")
    .eq("project_id", projectId);
  console.log("PROJECT_CREATORS=" + JSON.stringify(links.data?.map((l: any) => ({
    nickname: l.creators?.nickname,
    platformIdMasked: `${(l.creators?.platform_creator_id ?? "").slice(0, 4)}…`,
    followers: l.followers,
    matchScore: l.match_score,
    activityScore: l.activity_score,
    completeness: l.data_completeness,
    warnings: l.field_warnings,
    evidence: l.evidence_summary,
    semantic: (l.analysis_json as any)?.semantic?.map((v: any) => `${v.condition_id}:${v.verdict}`),
    snapshotFollowers: (l.creators?.latest_snapshot as any)?.followers,
    snapshotLikes: (l.creators?.latest_snapshot as any)?.likesCollected,
    posts: (l.creators?.latest_snapshot as any)?.posts?.length,
  })), null, 2));
  const jobFinal = await pool.query(
    `select status, stage, terminal, progress, message_code, error_code, result
     from private.jobs where type = 'creator_search' order by created_at desc limit 1`,
  );
  console.log("JOB=" + JSON.stringify(jobFinal.rows[0]));
} finally {
  // 清理测试数据
  const links = await client.from("project_creators").select("creator_id").eq("project_id", projectId);
  const creatorIds = links.data?.map((l) => l.creator_id) ?? [];
  if (creatorIds.length) {
    await client.from("project_creators").delete().eq("project_id", projectId);
    await client.from("creators").delete().in("id", creatorIds);
  }
  await client.from("search_tasks").delete().eq("id", taskId);
  await pool.query("delete from private.job_events where user_id = $1", [userId]);
  await pool.query("delete from private.jobs where user_id = $1", [userId]);
  await client.from("projects").delete().eq("id", projectId);
  await pool.end();
  console.log("CLEANED");
}
