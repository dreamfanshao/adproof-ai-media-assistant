import { createPostgresRedfoxCredentialStore } from "../server/src/services/redfox-credential-service.js";
import { createAuditDraft, submitAuditTask } from "../server/src/services/audit-service.js";
import { createSearchTask, getSearchTask } from "../server/src/services/creator-search-service.js";
import { extractSearchKeyword, parseSearchRuleHeuristic } from "../server/src/services/rule-parser.js";
import { runContentAuditJob } from "../worker/src/audit-executor.js";
import { runCreatorSearchJob } from "../worker/src/xhs-search-executor.js";
import {
  claimSearchJobById,
  createWorkerClient,
  createWorkerPool,
  type WorkerEnv,
} from "../worker/src/xhs-db.js";
import { resolveRedfoxRuntimeKey, WORKER_RUNTIME_VERSION } from "../worker/src/worker-runtime.js";

type Runtime = ReturnType<typeof createRuntime>;

let sharedRuntime: Runtime | null = null;

function createRuntime() {
  const env = process.env as unknown as WorkerEnv;
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL"].filter(
    (key) => !process.env[key],
  );
  if (missing.length) throw new Error(`真实评测环境缺少配置：${missing.join(", ")}`);
  return {
    env,
    client: createWorkerClient(env),
    pool: createWorkerPool(env),
  };
}

function runtime(): Runtime {
  sharedRuntime ??= createRuntime();
  return sharedRuntime;
}

async function resolveSystemContext(): Promise<{ userId: string; projectId: string; projectName: string }> {
  const { client } = runtime();
  const configuredProjectId = process.env.EVAL_PROJECT_ID?.trim();
  let query = client
    .from("projects")
    .select("id,user_id,name,status,updated_at")
    .eq("status", "active");
  if (configuredProjectId) query = query.eq("id", configuredProjectId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(2);
  if (error) throw new Error(`读取真实评测项目失败：${error.message}`);
  if (!data?.length) throw new Error("没有可用于真实评测的活跃项目");
  if (!configuredProjectId) {
    const users = new Set(data.map((row) => String(row.user_id)));
    if (users.size > 1) throw new Error("检测到多个用户，请通过 EVAL_PROJECT_ID 明确真实评测项目");
  }
  const project = data[0];
  return { userId: String(project.user_id), projectId: String(project.id), projectName: String(project.name) };
}

export interface RealCreatorEvalResult {
  context: { userId: string; projectId: string; projectName: string };
  task: NonNullable<Awaited<ReturnType<typeof getSearchTask>>>;
  creators: Array<Record<string, unknown>>;
  jobResult: Record<string, unknown> | null;
  keySource: string;
  keyFingerprint: string | null;
}

export async function runRealCreatorSystemTest(question: string): Promise<RealCreatorEvalResult> {
  const { env, client, pool } = runtime();
  const context = await resolveSystemContext();
  const confirmedRule = parseSearchRuleHeuristic(question, 20) as unknown as Record<string, unknown>;
  const keyword = extractSearchKeyword(question, confirmedRule as never);
  let created = await createSearchTask(client, pool, {
    userId: context.userId,
    projectId: context.projectId,
    queryText: question,
    confirmedRule,
    targetCount: 20,
    keyword,
    platforms: ["xiaohongshu"],
  });
  let job = await claimSearchJobById(pool, `eval-${process.pid}`, created.jobId);
  if (!job) throw new Error("真实检索 Job 未能领取，可能已被其他 Worker 领取");

  const credentialStore = env.XHS_SESSION_ENCRYPTION_KEY
    ? createPostgresRedfoxCredentialStore(pool, env.XHS_SESSION_ENCRYPTION_KEY)
    : null;
  const userApiKey = await credentialStore?.resolve(context.userId);
  let selectedKey = resolveRedfoxRuntimeKey(userApiKey, env.REDFOX_API_KEY);
  if (!selectedKey.apiKey) throw new Error("真实评测没有可用的 RedFoxHub API Key");
  let runtimeEnv = {
    ...env,
    REDFOX_API_KEY: selectedKey.apiKey,
    REDFOX_API_KEY_SOURCE: selectedKey.source,
    REDFOX_API_KEY_FINGERPRINT: selectedKey.fingerprint ?? undefined,
    WORKER_RUNTIME_VERSION,
  } as WorkerEnv;

  await runCreatorSearchJob(runtimeEnv, client, pool, job);
  let task = await getSearchTask(client, created.searchTaskId);
  if (!task) throw new Error("真实检索完成后未找到任务记录");
  const userKeyOutOfBalance = task.persisted_count === 0
    && selectedKey.source === "user"
    && /积分.*(?:不足|余额)|余额.*不足/.test(task.error_message ?? "");
  const systemKey = resolveRedfoxRuntimeKey(null, env.REDFOX_API_KEY);
  if (userKeyOutOfBalance && systemKey.apiKey && systemKey.fingerprint !== selectedKey.fingerprint) {
    created = await createSearchTask(client, pool, {
      userId: context.userId,
      projectId: context.projectId,
      queryText: question,
      confirmedRule,
      targetCount: 20,
      keyword,
      platforms: ["xiaohongshu"],
    });
    job = await claimSearchJobById(pool, `eval-${process.pid}`, created.jobId);
    if (!job) throw new Error("系统 Key 回退任务未能领取");
    selectedKey = { ...systemKey, source: "system" };
    runtimeEnv = {
      ...env,
      REDFOX_API_KEY: selectedKey.apiKey,
      REDFOX_API_KEY_SOURCE: selectedKey.source,
      REDFOX_API_KEY_FINGERPRINT: selectedKey.fingerprint ?? undefined,
      WORKER_RUNTIME_VERSION,
    } as WorkerEnv;
    await runCreatorSearchJob(runtimeEnv, client, pool, job);
    task = await getSearchTask(client, created.searchTaskId);
    if (!task) throw new Error("系统 Key 回退检索完成后未找到任务记录");
  }
  const { data: creators, error: creatorsError } = await client
    .from("project_creators")
    .select("id,creator_id,followers,activity_score,match_score,evidence_summary,analysis_json,captured_at")
    .eq("project_id", context.projectId)
    .eq("search_task_id", task.id);
  if (creatorsError) throw new Error(`读取真实达人结果失败：${creatorsError.message}`);
  const jobRow = await pool.query<{ result: Record<string, unknown> | null }>(
    "select result from private.jobs where id = $1",
    [created.jobId],
  );
  return {
    context,
    task,
    creators: (creators ?? []) as Array<Record<string, unknown>>,
    jobResult: jobRow.rows[0]?.result ?? null,
    keySource: selectedKey.source,
    keyFingerprint: selectedKey.fingerprint,
  };
}

export interface RealAuditEvalResult {
  context: { userId: string; projectId: string; projectName: string };
  task: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
  coverageWarnings: Array<Record<string, unknown>>;
  jobResult: Record<string, unknown> | null;
}

export async function runRealAuditSystemTest(input: {
  title: string;
  body: string;
  requirements: string;
}): Promise<RealAuditEvalResult> {
  const { env, client, pool } = runtime();
  const context = await resolveSystemContext();
  const draft = await createAuditDraft(client, {
    userId: context.userId,
    title: input.title,
    body: input.body,
    requirements: input.requirements,
  });
  const auditTaskId = String(draft.id);
  const submitted = await submitAuditTask(client, pool, context.userId, auditTaskId);
  const jobId = String(submitted.task_id);
  const job = await claimSearchJobById(pool, `eval-${process.pid}`, jobId);
  if (!job) throw new Error("真实审核 Job 未能领取，可能已被其他 Worker 领取");
  await runContentAuditJob(env, client, pool, job);

  const [{ data: task, error: taskError }, { data: findings, error: findingsError }, { data: warnings, error: warningsError }] = await Promise.all([
    client.from("audit_tasks").select("*").eq("id", auditTaskId).eq("user_id", context.userId).single(),
    client.from("audit_findings").select("*").eq("audit_task_id", auditTaskId).eq("user_id", context.userId),
    client.from("audit_coverage_warnings").select("code,message").eq("audit_task_id", auditTaskId).eq("user_id", context.userId),
  ]);
  if (taskError) throw new Error(`读取真实审核任务失败：${taskError.message}`);
  if (findingsError) throw new Error(`读取真实审核结果失败：${findingsError.message}`);
  if (warningsError) throw new Error(`读取审核覆盖警告失败：${warningsError.message}`);
  const jobRow = await pool.query<{ result: Record<string, unknown> | null }>(
    "select result from private.jobs where id = $1",
    [jobId],
  );
  return {
    context,
    task: task as Record<string, unknown>,
    findings: (findings ?? []) as Array<Record<string, unknown>>,
    coverageWarnings: (warnings ?? []) as Array<Record<string, unknown>>,
    jobResult: jobRow.rows[0]?.result ?? null,
  };
}
