// T07 Phase 1闂佹寧绻冮崙顡祌ker 闂佽桨鑳舵晶妤€鐣垫担鐑樺闁秆勵殕閿涙牠鎮?// public 闁荤偞渚楅悡澶屾濡炬瓱arch_tasks/creators/project_creators/platform_sessions闂佹寧绋戦ˇ杈╁垝?supabase-js闂佹寧绋戝鍍vice_role闂?// private schema闂佹寧绋戝鐖媌s/job_events闂佹寧绋戦ˇ顔剧箔婢舵劕姹查柟缁㈠枟閼荤喓绱?PostgREST闂佹寧绋戦惉鑲╁垝?pg 闂佺儵鏅濋ˉ鎰崲濞戙垺鏅柛顐ゅ枎铻氶梺鍝勭墱閸ㄩ亶寮婚悢濂夋禆闁割偆鍠愰敍鍡涙倵鐟欏嫮顣查柡宀€鍠庨锝堢疀閵壯咁槴
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseXhsSessionRepository,
  XhsSessionCipher,
} from "../../server/src/services/xhs-session-persistence.js";
import type { StoredXhsSession } from "../../server/src/services/xhs-session-persistence.js";
import type { Database } from "../../src/lib/database.types.js";

const { Pool } = pg;

export interface WorkerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  XHS_SESSION_ENCRYPTION_KEY: string;
  XHS_DATA_PROVIDER?: "redfox" | string;
  REDFOX_API_KEY?: string;
  REDFOX_API_KEY_SOURCE?: "user" | "system" | "none";
  REDFOX_API_KEY_FINGERPRINT?: string;
  REDFOX_CREATOR_SEARCH_PATH?: string;
  WORKER_RUNTIME_VERSION?: string;
  REDFOX_BASE_URL?: string;
  REDFOX_SEARCH_PATH?: string;
  REDFOX_NOTE_DETAIL_PATH?: string;
  REDFOX_VIDEO_NOTE_DETAIL_PATH?: string;
  REDFOX_USER_INFO_PATH?: string;
  REDFOX_USER_WORK_LIST_PATH?: string;
  REDFOX_AUTHOR_PERFORMANCE_PATH?: string;
  REDFOX_REQUEST_DELAY_MS?: string;
  REDFOX_MAX_RETRIES?: string;
  REDFOX_BACKOFF_BASE_MS?: string;
  REDFOX_TIMEOUT_MS?: string;
  REDFOX_SEARCH_PAGES?: string;
  REDFOX_SEARCH_MAX_PAGES_PER_KEYWORD?: string;
  REDFOX_MAX_REQUESTS_PER_SEARCH?: string;
  REDFOX_AUTO_CONTINUE_MAX_ROUNDS?: string;
  REDFOX_SEARCH_MAX_DURATION_MS?: string;
  REDFOX_SEARCH_NOTE_TYPE?: string;
  REDFOX_SEARCH_SORT_TYPE?: string;
  REDFOX_SEARCH_EXACT_MATCH?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  /** Supabase 闂佽桨鑳舵晶妤€鐣垫担瑙勫劅?pooler 闁哄鏅濋崑鐐垫暜鐎涙鈻旈悹鍥囧懐顦╅梺鍛婂嚬閸嬪嫰鎯侀幋锔藉剺濞撴艾锕︾粈鍡涙煥濞戞ê顨欑紒顔奸叄瀹曟ê鈻庤箛鎾虫辈 .env.local闂佹寧绋戞總鏃傜箔婢舵劕绀傞柕澶涢檮閻庮喗淇?*/
  DATABASE_URL: string;
}

export interface SearchJob {
  id: string;
  task_id: string;
  user_id: string;
  type: string;
  status: string;
  stage: string;
  terminal: boolean;
  progress: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  retry_after_seconds: number | null;
  locked_by?: string | null;
  lease_version?: number;
}

export interface SearchJobPayload {
  search_task_id: string;
  project_id: string;
  keyword: string;
  query_text?: string;
  target_count: number;
  confirmed_rule: Record<string, unknown>;
  platforms?: Array<"xiaohongshu">;
}

export function createWorkerClient(env: WorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createWorkerPool(env: WorkerEnv): pg.Pool {
  // Supabase Pooler 闁荤喐娲戦悞锕傛儑?TLS闂佹寧绋掓鐩嘥ABASE_URL 婵炴垶鎹佸銊ц姳閿熺姵鐒奸柛顭戝枛鐢娊鏌熺捄鐚撮練缂佺粯鐩獮鎺楀Ψ閵夈儲顥濋梺杞扮劍濠㈡﹢宕幘瀛樹氦婵炴垶鐟﹂悗顔戒繆濡ゅ绉剁紒?
  // 閺夆晜绮庨埢?Supabase Pooler 濞达綀娉曢弫?TLS闁挎稒绋掑﹢浼村捶閺夎法纾婚柛娆愬灱缁绘盯骞掗妷銈囩闁归晲鑳跺ú鎸庢交閻愵亖鍋?
  const isLocal = /^(postgres(?:ql)?:\/\/)(localhost|127\.0\.0\.1)(?::|\/)/i.test(env.DATABASE_URL);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: isLocal ? undefined : { rejectUnauthorized: process.env.NODE_ENV === "production" },
    // 閻熸粎澧楅幐鍛婃櫠?Windows 闂佺粯绮犻崹浼淬€傞妸鈺佽Е閻忕偟鍋撻ˇ褔鎮峰▎娆戠ɑ闁诲簼绮欏畷娆愭姜閹殿喚鎲归梺鍛婄懐閸ㄧ敻骞?IPv6 闂侀潻闄勫妯侯焽閸愵喗鏅悘鐐舵缁讳線鏌?worker 闁?Supabase Pooler 闂?IPv4闂?    ...(isLocal ? {} : { family: 4 }),
    max: 2,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });
  // pg emits errors from idle clients asynchronously. Without a listener an
  // otherwise recoverable network reset becomes an unhandled process error and
  // stops the Worker, leaving queued searches invisible to the UI.
  pool.on("error", (error) => {
    console.error("[worker] postgres pool error:", error instanceof Error ? error.message : String(error));
  });
  return pool;
}

export function loadStoredSession(env: WorkerEnv, userId: string): Promise<StoredXhsSession | null> {
  const repository = createSupabaseXhsSessionRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const cipher = new XhsSessionCipher(env.XHS_SESSION_ENCRYPTION_KEY);
  return (async () => {
    const stored = await repository.load(userId);
    if (!stored || stored.connection.status !== "connected" || !stored.encryptedState) return null;
    const expiresAt = stored.connection.session_expires_at
      ? Date.parse(stored.connection.session_expires_at)
      : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    return { ...stored, encryptedState: stored.encryptedState };
  })();
}

export function decryptStorageState(
  stored: StoredXhsSession,
  env: WorkerEnv,
): Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>> {
  if (!stored.encryptedState) throw new Error("missing encrypted session state");
  const cipher = new XhsSessionCipher(env.XHS_SESSION_ENCRYPTION_KEY);
  return cipher.decrypt(stored.encryptedState) as Awaited<ReturnType<import("playwright").BrowserContext["storageState"]>>;
}

function mapJobRow(row: Record<string, unknown>): SearchJob {
  return {
    id: row.id as string,
    task_id: row.task_id as string,
    user_id: row.user_id as string,
    type: row.type as string,
    status: row.status as string,
    stage: row.stage as string,
    terminal: row.terminal as boolean,
    progress: row.progress as number,
    payload: row.payload as Record<string, unknown>,
    result: (row.result as Record<string, unknown> | null) ?? null,
    attempts: row.attempts as number,
    max_attempts: row.max_attempts as number,
    cancel_requested: row.cancel_requested as boolean,
    error_code: row.error_code as string | null,
    error_message: row.error_message as string | null,
    retryable: row.retryable as boolean,
    retry_after_seconds: row.retry_after_seconds as number | null,
    locked_by: (row.locked_by as string | null) ?? null,
    lease_version: Number(row.lease_version ?? 0),
  };
}

export type JobExecutionControl = "continue" | "cancelled" | "lease_lost";

/**
 * Extends the lease only while the caller still owns the running job. The
 * returned control value also makes cancellation visible inside long jobs.
 */
export async function refreshJobLease(
  pool: pg.Pool,
  jobId: string,
  workerId: string,
  leaseMs = 10 * 60 * 1000,
): Promise<JobExecutionControl> {
  const leaseSeconds = Math.max(60, Math.round(leaseMs / 1000));
  const result = await pool.query(
    `update private.jobs
     set lock_expires_at = now() + ($3::text || ' seconds')::interval,
         updated_at = now()
     where id = $1 and status = 'running' and terminal = false and locked_by = $2
     returning cancel_requested`,
    [jobId, workerId, leaseSeconds],
  );
  if (!result.rowCount) return "lease_lost";
  return result.rows[0]?.cancel_requested === true ? "cancelled" : "continue";
}

/**
 * Claims one known job without racing unrelated queue entries.
 * Used by the local Eval service to execute the exact production worker path.
 */
export async function claimSearchJobById(
  pool: pg.Pool,
  workerId: string,
  jobId: string,
  leaseMs = 30 * 60 * 1000,
): Promise<SearchJob | null> {
  const leaseSeconds = Math.max(60, Math.round(leaseMs / 1000));
  const result = await pool.query(
    `update private.jobs
     set status = 'running', locked_by = $1,
         lock_expires_at = now() + ($3::text || ' seconds')::interval,
         lease_version = lease_version + 1, attempts = attempts + 1,
         stage = 'queued', message_code = 'JOB_STARTING', updated_at = now()
     where id = $2 and status = 'queued' and attempts < max_attempts
       and run_after <= now() and cancel_requested = false
     returning *`,
    [workerId, jobId, leaseSeconds],
  );
  if (!result.rowCount) return null;
  return mapJobRow(result.rows[0]);
}

/** 闂佸憡顭囬崰搴ㄦ偤濞嗘劧绱ｉ柛鈩冾殔缁?queued job闂佹寧绋戝﹢妗筊 UPDATE SKIP LOCKED闂佹寧绋戦¨鈧紒閬嶄憾瀹?running 缂備礁顦遍崰鎾垛偓瑙勫▕楠炰線濮€閻欌偓濡插鏌ㄥ☉娆戭敜ype 闂佸湱顭堝ú銈夋偩?job 缂備緡鍋夐褔鎮?*/
export async function claimSearchJob(
  pool: pg.Pool,
  workerId: string,
  type = "creator_search",
  leaseMs = 10 * 60 * 1000,
): Promise<SearchJob | null> {
  const lease = `interval '${Math.round(leaseMs / 1000)} seconds'`;
  const normal = await pool.query(
    `with candidate as (
       select id from private.jobs
       where type = $2 and status = 'queued'
         and attempts < max_attempts
         and run_after <= now() and cancel_requested = false
       order by created_at limit 1 for update skip locked
     )
     update private.jobs j
     set status = 'running', locked_by = $1, lock_expires_at = now() + ${lease},
         lease_version = j.lease_version + 1, attempts = j.attempts + 1,
         stage = 'queued', message_code = 'JOB_STARTING', updated_at = now()
     from candidate c where j.id = c.id
     returning j.*`,
    [workerId, type],
  );
  if (normal.rowCount && normal.rowCount > 0) return mapJobRow(normal.rows[0]);

  const stale = await pool.query(
    `with candidate as (
       select id from private.jobs
       where type = $2 and status = 'running' and lock_expires_at < now()
         and attempts < max_attempts
       order by created_at limit 1 for update skip locked
     )
     update private.jobs j
     set locked_by = $1, lock_expires_at = now() + ${lease}, lease_version = j.lease_version + 1,
         attempts = j.attempts + 1, updated_at = now()
     from candidate c where j.id = c.id
     returning j.*`,
    [workerId, type],
  );
  if (stale.rowCount && stale.rowCount > 0) return mapJobRow(stale.rows[0]);
  return null;
}

export async function reapExhaustedJobs(pool: pg.Pool, type = "creator_search"): Promise<SearchJob[]> {
  const exhausted = await pool.query(
    `update private.jobs
     set status = 'failed', stage = 'queued', terminal = true, progress = 100,
         message_code = 'WORKER_RETRY_EXHAUSTED', error_code = 'WORKER_RETRY_EXHAUSTED',
         error_message = 'Worker retry limit reached before the task could make progress.',
         retryable = false, completed_at = now(), locked_by = null, lock_expires_at = null, updated_at = now()
     where type = $1 and status = 'running' and lock_expires_at < now()
       and attempts >= max_attempts
     returning *`,
    [type],
  );
  const jobs = exhausted.rows.map(mapJobRow);
  for (const job of jobs) {
    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "failed",
      stage: job.stage,
      terminal: true,
      progress: 100,
      messageCode: "WORKER_RETRY_EXHAUSTED",
      errorCode: "WORKER_RETRY_EXHAUSTED",
      errorMessage: "Worker retry limit reached before the task could make progress.",
      retryable: false,
      result: job.result,
    });
  }
  return jobs;
}

export interface JobEventInput {
  jobId: string;
  userId: string;
  status: string;
  stage: string;
  terminal: boolean;
  progress: number;
  messageCode: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  retryAfterSeconds?: number | null;
  result?: Record<string, unknown> | null;
  data?: Record<string, unknown>;
}

/** 闂佸搫娲ら悺銊╁蓟?job 闂佺粯顭堥崺鏍焵?+ 闂佸憡鍔栭悷銉╁矗?job_events闂佹寧绋戝鍍 闂佺厧顨庢禍婊埪烽崘顔芥櫖濠㈣埖绋撶粈澶愭煕濡や焦纾荤紒銊ｅ姂瀹?*/
export async function finishJob(pool: pg.Pool, input: JobEventInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update private.jobs
       set status = $1, stage = $2, terminal = $3, progress = $4, message_code = $5,
           error_code = $6, error_message = $7, retryable = $8, retry_after_seconds = $9,
           result = $10,
           completed_at = case when $3::boolean then now() end,
           locked_by = null, lock_expires_at = null, updated_at = now()
       where id = $11`,
      [
        input.status,
        input.stage,
        input.terminal,
        input.progress,
        input.messageCode,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.retryable ?? false,
        input.retryAfterSeconds ?? null,
        input.result ?? null,
        input.jobId,
      ],
    );
    const seqResult = await client.query("select coalesce(max(seq), 0) + 1 as seq from private.job_events where job_id = $1", [input.jobId]);
    const seq = seqResult.rows[0].seq as number;
    await client.query(
      `insert into private.job_events
         (job_id, user_id, seq, status, stage, terminal, progress, message_code, error_code, retry_after_seconds, data)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        input.jobId,
        input.userId,
        seq,
        input.status,
        input.stage,
        input.terminal,
        input.progress,
        input.messageCode,
        input.errorCode ?? null,
        input.retryAfterSeconds ?? null,
        input.data ?? {},
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** 闂佸搫娲ら悺銊╁蓟?search_tasks 闂佺粯顭堥崺鏍焵?闁哄鏅滅粙鎴犫偓?闁荤姳璁查崜婵嬪汲閻斿吋鏅柛褜婧乥lic schema闂佹寧绋戦鎶瞤abase-js闂?*/
export async function updateSearchTask(
  client: SupabaseClient,
  searchTaskId: string,
  patch: {
    status?: string;
    progress?: number;
    terminal?: boolean;
    stageMessageCode?: string;
    collectedCount?: number;
    persistedCount?: number;
    duplicateCount?: number;
    stageCounts?: Record<string, number>;
    loopState?: Record<string, unknown>;
    canContinue?: boolean;
    partialReason?: Database["public"]["Enums"]["search_partial_reason"] | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const taskUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.status !== undefined) taskUpdate.status = patch.status;
  if (patch.progress !== undefined) taskUpdate.progress = patch.progress;
  if (patch.terminal !== undefined) taskUpdate.terminal = patch.terminal;
  if (patch.stageMessageCode !== undefined) taskUpdate.message_code = patch.stageMessageCode;
  if (patch.collectedCount !== undefined) taskUpdate.collected_count = patch.collectedCount;
  if (patch.persistedCount !== undefined) taskUpdate.persisted_count = patch.persistedCount;
  if (patch.duplicateCount !== undefined) taskUpdate.duplicate_count = patch.duplicateCount;
  if (patch.stageCounts !== undefined) taskUpdate.stage_counts = patch.stageCounts;
  if (patch.loopState !== undefined) taskUpdate.loop_state = patch.loopState;
  if (patch.canContinue !== undefined) taskUpdate.can_continue = patch.canContinue;
  if (patch.partialReason !== undefined) taskUpdate.partial_reason = patch.partialReason;
  if (patch.errorCode !== undefined) taskUpdate.error_code = patch.errorCode;
  if (patch.errorMessage !== undefined) taskUpdate.error_message = patch.errorMessage;
  if (patch.terminal) taskUpdate.completed_at = new Date().toISOString();
  const { error } = await client.from("search_tasks").update(taskUpdate).eq("id", searchTaskId);
  if (error) throw new Error(`updateSearchTask: ${error.message}`);
}


