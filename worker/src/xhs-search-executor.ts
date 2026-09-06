import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { runRedfoxCreatorSearchJob } from "./redfox-search-executor.js";
import { finishJob, updateSearchTask, type SearchJob, type WorkerEnv } from "./xhs-db.js";

/**
 * Single entry point for creator-search jobs.
 * All production searches are routed to RedFoxHub's Xiaohongshu APIs.
 */
export async function runCreatorSearchJob(
  env: WorkerEnv,
  client: SupabaseClient,
  pool: pg.Pool,
  job: SearchJob,
): Promise<void> {
  if (String(env.XHS_DATA_PROVIDER ?? "redfox").toLowerCase() !== "redfox") {
    const message = "当前仅支持 RedFoxHub 小红书数据源，请设置 XHS_DATA_PROVIDER=redfox。";
    await updateSearchTask(client, job.payload.search_task_id as string, {
      status: "failed",
      terminal: true,
      progress: 100,
      errorCode: "XHS_REDFOX_ONLY",
      errorMessage: message,
    });
    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "failed",
      stage: "collecting",
      terminal: true,
      progress: 100,
      messageCode: "XHS_REDFOX_ONLY",
      errorCode: "XHS_REDFOX_ONLY",
      retryable: false,
    });
    return;
  }
  await runRedfoxCreatorSearchJob(env, client, pool, job);
}
