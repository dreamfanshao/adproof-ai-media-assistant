// T07 Phase 1｜Worker 守护进程：轮询领取 creator_search job 并执行
// 运行：npx tsx worker/src/index.ts（需 .env.local 含 DATABASE_URL）
import { loadWorkerEnv } from "./environment.js";
import { claimSearchJob, createWorkerClient, createWorkerPool, finishJob, reapExhaustedJobs, updateSearchTask, type SearchJob, type WorkerEnv } from "./xhs-db.js";
import { runCreatorSearchJob } from "./xhs-search-executor.js";
import { runKnowledgeIngestJob } from "./knowledge-ingest-executor.js";
import { runContentAuditJob } from "./audit-executor.js";
import { createPostgresRedfoxCredentialStore } from "../../server/src/services/redfox-credential-service.js";
import { acquireWorkerSingleton, resolveRedfoxRuntimeKey, WORKER_RUNTIME_VERSION, type WorkerSingletonLease } from "./worker-runtime.js";

function loadEnv(): WorkerEnv {
  return loadWorkerEnv();
}

const env = loadEnv();
Object.assign(process.env, env);
if (!env.DATABASE_URL) {
  console.error("[worker] DATABASE_URL 未配置：请在 .env.local 写入 Supabase 数据库连接串（含密码）后重试");
  process.exit(1);
}

const client = createWorkerClient(env);
const pool = createWorkerPool(env);
const redfoxCredentialStore = env.XHS_SESSION_ENCRYPTION_KEY
  ? createPostgresRedfoxCredentialStore(pool, env.XHS_SESSION_ENCRYPTION_KEY)
  : null;
const workerId = `worker-${process.pid}`;
const POLL_MS = 5_000;
let singletonLease: WorkerSingletonLease | null = null;
let stopping = false;

async function runJob(job: SearchJob): Promise<void> {
  if (job.type === "creator_search") {
    // 每个新任务重新读取 .env.local；用户在前台保存的专属 Key 优先于系统默认 Key。
    // Key 仅保存在当前任务内存中，不进入 job payload、日志或任务结果。
    const refreshedEnv = { ...env, ...loadEnv() } as WorkerEnv;
    Object.assign(process.env, refreshedEnv);
    const userApiKey = await redfoxCredentialStore?.resolve(job.user_id);
    const selectedKey = resolveRedfoxRuntimeKey(userApiKey, refreshedEnv.REDFOX_API_KEY);
    const runtimeEnv = {
      ...refreshedEnv,
      REDFOX_API_KEY: selectedKey.apiKey,
      REDFOX_API_KEY_SOURCE: selectedKey.source,
      REDFOX_API_KEY_FINGERPRINT: selectedKey.fingerprint ?? undefined,
      WORKER_RUNTIME_VERSION,
    } as WorkerEnv;
    console.log(`[worker] ${job.id.slice(0, 8)}… redfox=${selectedKey.source}#${selectedKey.fingerprint ?? "none"} endpoint=${runtimeEnv.REDFOX_CREATOR_SEARCH_PATH ?? "/story/api/xhs/ability/searchWork"} runtime=${WORKER_RUNTIME_VERSION}`);
    await runCreatorSearchJob(runtimeEnv, client, pool, job);
  } else if (job.type === "knowledge_ingest") {
    await runKnowledgeIngestJob(env, client, pool, job);
  } else if (job.type === "content_audit") {
    await runContentAuditJob(env, client, pool, job);
  } else {
    await pool.query(
      "update private.jobs set status='failed', terminal=true, error_code='UNSUPPORTED_JOB_TYPE', completed_at=now(), locked_by=null, lock_expires_at=null, updated_at=now() where id=$1",
      [job.id],
    );
  }
}

async function tick(): Promise<void> {
  for (const type of ["creator_search", "knowledge_ingest", "content_audit"]) {
    if (stopping) return;
    const exhausted = await reapExhaustedJobs(pool, type);
    for (const stale of exhausted) {
      const taskId = stale.payload?.search_task_id as string | undefined;
      if (type === "creator_search" && taskId) {
        await updateSearchTask(client, taskId, {
          status: "failed",
          terminal: true,
          progress: 100,
          stageMessageCode: "WORKER_RETRY_EXHAUSTED",
          errorCode: "WORKER_RETRY_EXHAUSTED",
          errorMessage: "Worker 重试已达上限，任务未能开始执行。",
        });
      }
      console.error(`[worker] closed exhausted ${type} job ${stale.id.slice(0, 8)}… attempts=${stale.attempts}/${stale.max_attempts}`);
    }
    const job = await claimSearchJob(pool, workerId, type);
    if (!job) continue;
    const ref = (job.payload?.search_task_id as string | undefined) ?? (job.payload?.document_id as string | undefined) ?? (job.payload?.audit_task_id as string | undefined) ?? "?";
    console.log(`[worker] claimed ${type} job ${job.id.slice(0, 8)}… ref=${String(ref).slice(0, 8)}…`);
    try {
      await runJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = job.attempts >= job.max_attempts;
      const taskId = job.payload?.search_task_id as string | undefined;
      if (type === "creator_search" && taskId) {
        await updateSearchTask(client, taskId, {
          status: exhausted ? "failed" : "queued",
          terminal: exhausted,
          progress: exhausted ? 100 : 0,
          stageMessageCode: exhausted ? "WORKER_RETRY_EXHAUSTED" : "WORKER_RETRY_SCHEDULED",
          errorCode: exhausted ? "WORKER_RETRY_EXHAUSTED" : "WORKER_EXECUTION_FAILED",
          errorMessage: message,
        });
      }
      await finishJob(pool, {
        jobId: job.id,
        userId: job.user_id,
        status: exhausted ? "failed" : "queued",
        stage: job.stage,
        terminal: exhausted,
        progress: exhausted ? 100 : 0,
        messageCode: exhausted ? "WORKER_RETRY_EXHAUSTED" : "WORKER_RETRY_SCHEDULED",
        errorCode: exhausted ? "WORKER_RETRY_EXHAUSTED" : "WORKER_EXECUTION_FAILED",
        errorMessage: message,
        retryable: !exhausted,
        retryAfterSeconds: exhausted ? null : 5,
        result: job.result,
      });
      console.error(`[worker] ${type} job ${job.id.slice(0, 8)}… failed attempt ${job.attempts}/${job.max_attempts}: ${message}`);
      return;
    }
    console.log(`[worker] finished ${type} job ${job.id.slice(0, 8)}…`);
    return;
  }
}

async function main(): Promise<void> {
  singletonLease = await acquireWorkerSingleton(pool);
  if (!singletonLease) {
    console.error("[worker] another Worker already owns the shared queue; this duplicate instance will exit");
    await pool.end();
    return;
  }
  console.log(`[worker] ${workerId} started，轮询间隔 ${POLL_MS}ms`);
  while (!stopping) {
    try {
      await tick();
    } catch (error) {
      console.error("[worker] tick error:", error instanceof Error ? error.message : String(error));
    }
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const shutdown = (): void => {
  stopping = true;
  console.log("[worker] draining current job; no new jobs will be claimed");
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

void main().catch((error) => {
  console.error("[worker] startup/loop failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await singletonLease?.release();
  singletonLease = null;
  if (!pool.ended) await pool.end();
});
