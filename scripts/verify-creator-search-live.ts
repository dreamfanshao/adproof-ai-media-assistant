import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseSearchRuleHeuristic } from "../server/src/services/rule-parser.js";
import { createWorkerPool } from "../worker/src/xhs-db.js";

const DEFAULT_QUERY = "1000-5000粉丝左右的博主，做过医美（光子嫩肤/超声炮/热玛吉/皮秒/点阵等医美项目）或者玫瑰皮肤/晒斑皮肤/雀斑皮肤等皮肤较差的，需要有发过类似的笔记，近三个月笔记点赞10个以上";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const projectId = argument("project-id");
const query = argument("query") ?? DEFAULT_QUERY;
const targetCount = Math.min(20, Math.max(1, Number(argument("target") ?? 20)));
const timeoutMinutes = Math.max(1, Number(argument("timeout-minutes") ?? 40));
if (!projectId) throw new Error("--project-id is required");

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey || !process.env.DATABASE_URL) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL are required");
}

const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
const pool = createWorkerPool(process.env as never);
const startedAt = Date.now();
let taskId = randomUUID();
let jobId = randomUUID();
const idempotencyKey = randomUUID();

try {
  const { data: project, error: projectError } = await client
    .from("projects")
    .select("id,user_id,name")
    .eq("id", projectId)
    .single();
  if (projectError || !project) throw new Error(`project lookup failed: ${projectError?.message ?? "not found"}`);

  const requestedTaskId = argument("task-id");
  const { data: active, error: activeError } = await client
    .from("search_tasks")
    .select("id,task_id,status")
    .eq("project_id", projectId)
    .in("status", ["queued", "validating_session", "collecting", "hard_filtering", "analyzing", "persisting"]);
  if (activeError) throw activeError;
  let attached = requestedTaskId
    ? (active ?? []).find((item) => item.id === requestedTaskId)
    : (active ?? [])[0];
  if (requestedTaskId && !attached) {
    const { data: requested, error: requestedError } = await client
      .from("search_tasks")
      .select("id,task_id,status")
      .eq("id", requestedTaskId)
      .maybeSingle();
    if (requestedError) throw requestedError;
    attached = requested ?? undefined;
  }
  if (requestedTaskId && !attached) throw new Error(`task not found: ${requestedTaskId}`);
  if (attached) {
    taskId = String(attached.id);
    jobId = String(attached.task_id);
    console.log(JSON.stringify({ event: "attached", project: project.name, taskId, jobId, targetCount }));
  }

  const confirmedRule = parseSearchRuleHeuristic(query, 50);
  const payload = {
    search_task_id: taskId,
    project_id: projectId,
    keyword: "光子嫩肤 超声炮 热玛吉",
    query_text: query,
    target_count: targetCount,
    confirmed_rule: confirmedRule,
    platforms: ["xiaohongshu"],
  };

  if (!attached) {
    await pool.query(
      "insert into private.jobs (id,user_id,type,status,stage,payload,idempotency_scope,idempotency_key,run_after) values ($1,$2,'creator_search','queued','queued',$3,'creator_search',$4,now())",
      [jobId, project.user_id, payload, idempotencyKey],
    );
    const { error: taskError } = await client.from("search_tasks").insert({
      id: taskId,
      task_id: jobId,
      user_id: project.user_id,
      project_id: projectId,
      idempotency_key: idempotencyKey,
      query_text: query,
      confirmed_rule: confirmedRule,
      target_count: targetCount,
    });
    if (taskError) {
      await pool.query("delete from private.jobs where id=$1", [jobId]);
      throw taskError;
    }
    console.log(JSON.stringify({ event: "created", project: project.name, taskId, jobId, targetCount }));
  }
  const deadline = Date.now() + timeoutMinutes * 60_000;
  let lastSignature = "";
  for (;;) {
    const { data: task, error } = await client
      .from("search_tasks")
      .select("id,status,message_code,progress,terminal,collected_count,persisted_count,duplicate_count,stage_counts,partial_reason,error_code,error_message,updated_at")
      .eq("id", taskId)
      .single();
    if (error || !task) throw new Error(`task polling failed: ${error?.message ?? "not found"}`);
    const signature = JSON.stringify([task.status, task.progress, task.collected_count, task.persisted_count, task.stage_counts, task.error_code]);
    if (signature !== lastSignature) {
      console.log(JSON.stringify({ event: "progress", elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), ...task }));
      lastSignature = signature;
    }
    if (task.terminal) {
      const job = await pool.query("select status,result,error_code,error_message from private.jobs where id=$1", [jobId]);
      const final = { task, job: job.rows[0] ?? null };
      console.log(JSON.stringify({ event: "terminal", ...final }, null, 2));
      if (task.status !== "completed" || Number(task.persisted_count) !== targetCount) {
        throw new Error(`live search did not reach ${targetCount}: status=${task.status}, persisted=${task.persisted_count}`);
      }
      break;
    }
    if (Date.now() >= deadline) throw new Error(`live search timed out after ${timeoutMinutes} minutes`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
} finally {
  await pool.end();
}
