import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { run as runSkillsAgent } from "../../agent/run-agent.js";
import { SEMANTIC_SCHEMA_VERSION, computeActivityScore } from "./xhs-semantic-matcher.js";
import { createTikHubXhsClient, type TikHubCreatorProfile } from "./tikhub-xhs-client.js";
import {
  finishJob,
  updateSearchTask,
  type SearchJob,
  type SearchJobPayload,
  type WorkerEnv,
} from "./xhs-db.js";

interface RuleCondition {
  field: string;
  operator: "lt" | "lte" | "gt" | "gte" | "eq";
  value: number | string | boolean;
}

interface ParsedRule {
  hard_filters?: { followers?: RuleCondition };
}

function canonicalProfileUrl(profileUrl: string, creatorId: string): string {
  const match = profileUrl.match(/\/user\/profile\/([^/?#]+)/i);
  return `https://www.xiaohongshu.com/user/profile/${match?.[1] ?? creatorId}`;
}

function satisfies(value: number, condition: RuleCondition): boolean {
  const target = Number(condition.value);
  switch (condition.operator) {
    case "lt": return value < target;
    case "lte": return value <= target;
    case "gt": return value > target;
    case "gte": return value >= target;
    case "eq": return value === target;
    default: return true;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** TikHub 临时数据源的达人检索执行器。它复用现有 Agent、去重、持久化和任务状态链路。 */
export async function runTikHubCreatorSearchJob(
  env: WorkerEnv,
  client: SupabaseClient,
  pool: pg.Pool,
  job: SearchJob,
): Promise<void> {
  const payload = job.payload as unknown as SearchJobPayload;
  const { search_task_id: taskId, project_id: projectId, keyword, query_text: queryText, target_count: targetCount, confirmed_rule } = payload;
  const rule = (confirmed_rule ?? {}) as ParsedRule;
  const followersCond = rule.hard_filters?.followers;

  if (job.cancel_requested) {
    await updateSearchTask(client, taskId, { status: "cancelled", terminal: true, progress: 100, errorCode: null, errorMessage: null });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "cancelled", stage: "queued", terminal: true, progress: 100, messageCode: "SEARCH_CANCELLED" });
    return;
  }

  if (!env.TIKHUB_TOKEN) {
    await updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_TIKHUB_NOT_CONFIGURED", errorMessage: "TikHub 数据源未配置，请在服务端 .env.local 设置 TIKHUB_TOKEN。" });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "XHS_TIKHUB_NOT_CONFIGURED", errorCode: "XHS_TIKHUB_NOT_CONFIGURED", retryable: false });
    return;
  }

  await updateSearchTask(client, taskId, { status: "collecting", progress: 10, stageMessageCode: "SEARCH_COLLECTING_TIKHUB" });
  const collector = createTikHubXhsClient({
    TIKHUB_TOKEN: env.TIKHUB_TOKEN,
    TIKHUB_BASE_URL: env.TIKHUB_BASE_URL,
    TIKHUB_SEARCH_PATH: env.TIKHUB_SEARCH_PATH,
    TIKHUB_IMAGE_NOTE_DETAIL_PATH: env.TIKHUB_IMAGE_NOTE_DETAIL_PATH,
    TIKHUB_VIDEO_NOTE_DETAIL_PATH: env.TIKHUB_VIDEO_NOTE_DETAIL_PATH,
    TIKHUB_USER_INFO_PATH: env.TIKHUB_USER_INFO_PATH,
    TIKHUB_USER_POSTED_NOTES_PATH: env.TIKHUB_USER_POSTED_NOTES_PATH,
  });

  let collected: TikHubCreatorProfile[];
  let requestCount = 0;
  let retryCount = 0;
  try {
    const result = await collector.collectCreatorProfiles(keyword, targetCount);
    collected = result.profiles;
    requestCount = result.requestCount;
    retryCount = result.retryCount;
  } catch (error) {
    const message = errorMessage(error);
    await updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_TIKHUB_REQUEST_FAILED", errorMessage: message });
    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "failed",
      stage: "collecting",
      terminal: true,
      progress: 100,
      messageCode: "XHS_TIKHUB_REQUEST_FAILED",
      errorCode: "XHS_TIKHUB_REQUEST_FAILED",
      errorMessage: message,
      retryable: true,
      retryAfterSeconds: 60,
      result: { source: "tikhub", requestCount, retryCount },
    });
    return;
  }

  if (!collected.length) {
    await updateSearchTask(client, taskId, { status: "partial", terminal: true, progress: 100, partialReason: "source_exhausted", errorMessage: "TikHub 未返回可识别的达人数据。" });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "partial", stage: "collecting", terminal: true, progress: 100, messageCode: "SEARCH_EMPTY", result: { source: "tikhub", collected: 0, requestCount, retryCount } });
    return;
  }
  await updateSearchTask(client, taskId, { collectedCount: collected.length, progress: 30 });

  let persisted = 0;
  let duplicates = 0;
  let filtered = 0;
  for (const profile of collected) {
    if (persisted >= targetCount) break;
    const creatorId = profile.ref.platformCreatorId;
    const stableProfileUrl = canonicalProfileUrl(profile.ref.profileUrl, creatorId);
    const fields = profile.fields;

    const existingCreator = await client.from("creators").select("id").eq("platform", "xiaohongshu").eq("platform_creator_id", creatorId).maybeSingle();
    if (existingCreator.data) {
      const existingLink = await client.from("project_creators").select("id").eq("project_id", projectId).eq("creator_id", existingCreator.data.id).maybeSingle();
      if (existingLink.data) {
        duplicates += 1;
        continue;
      }
    }

    // 硬条件缺少粉丝数时不默认为命中，避免 TikHub 返回不完整数据造成误筛。
    if (followersCond && (fields.followers === null || !satisfies(fields.followers, followersCond))) {
      filtered += 1;
      continue;
    }

    const agentRun = await runSkillsAgent(queryText ?? keyword, [{
      id: creatorId,
      nickname: fields.nickname ?? "",
      handle: fields.handle ?? undefined,
      profileUrl: stableProfileUrl,
      followers: fields.followers ?? undefined,
      activity: undefined,
      bio: fields.bio ?? undefined,
      posts: fields.posts,
      imageUrls: fields.imageUrls,
    }]);
    const agentCandidate = agentRun.candidates[0] as {
      semanticMatch?: { matched?: boolean; confidence?: number; evidence?: string[]; reasons?: string[] };
      imageEvidence?: unknown;
      matchScore?: number;
    } | undefined;
    const activity = computeActivityScore(fields.posts);
    const match = agentCandidate?.semanticMatch ?? {};
    const confidence = Math.max(0, Math.min(1, Number(match.confidence ?? 0)));
    const evidence = [...(match.evidence ?? []), ...(match.reasons ?? [])];
    const semantic = {
      conditions: [{ condition_id: "agent_semantic_match", verdict: match.matched ? "matched" : "not_matched", confidence, evidence_ids: evidence.map((_, index) => `agent-${index}`), reason: evidence.join(" | ") || "LLM evidence unavailable" }],
      activity: { score: activity.score, posts: fields.posts.length, medianInteraction: activity.medianInteraction },
      matchScore: Number(agentCandidate?.matchScore ?? 0),
      evidenceSummary: evidence.join(" | ") || agentRun.disclaimer,
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      matcher: agentRun.status === "scored" ? "llm" : "pending_llm",
      imageEvidence: agentCandidate?.imageEvidence,
      llmStatus: agentRun.status,
      source: "tikhub",
    };

    const { data: creator, error: creatorError } = await client.from("creators").upsert({
      platform: "xiaohongshu",
      platform_creator_id: creatorId,
      nickname: fields.nickname ?? "未知达人",
      handle: fields.handle,
      profile_url: stableProfileUrl,
      avatar_url: fields.avatarUrl,
      latest_snapshot: { ...fields, source: "tikhub" } as unknown as Record<string, unknown>,
      latest_captured_at: fields.capturedAt,
    }, { onConflict: "platform,platform_creator_id" }).select("id").single();
    if (creatorError || !creator) throw new Error(`upsert creator: ${creatorError?.message ?? "no row"}`);

    const { data: linkRow, error: linkError } = await client.from("project_creators").upsert({
      user_id: job.user_id,
      project_id: projectId,
      creator_id: creator.id,
      search_task_id: taskId,
      decision_status: "pending",
      contact_status: "not_contacted",
      followers: fields.followers,
      activity_score: semantic.activity.score,
      match_score: semantic.matchScore,
      data_completeness: fields.dataCompleteness,
      field_warnings: fields.warnings as unknown as unknown[],
      evidence_summary: semantic.evidenceSummary,
      analysis_json: { semantic: semantic.conditions, activity: semantic.activity, posts: fields.posts, imageUrls: fields.imageUrls, llm_status: semantic.llmStatus, image_evidence: semantic.imageEvidence, matcher: semantic.matcher, schema_version: semantic.schemaVersion, source: "tikhub" } as unknown as Record<string, unknown>,
      captured_at: fields.capturedAt,
    }, { onConflict: "project_id,creator_id" }).select("id").single();
    if (linkError || !linkRow) throw new Error(`upsert project_creator: ${linkError?.message ?? "no row"}`);

    const { error: evidenceError } = await client.from("creator_evidence").insert({
      user_id: job.user_id,
      project_creator_id: linkRow.id,
      evidence_type: "ai_analysis",
      source_url: stableProfileUrl,
      excerpt: semantic.evidenceSummary.slice(0, 2000),
      confidence: semantic.conditions.length ? Math.min(...semantic.conditions.map((value) => value.confidence)) : null,
      captured_at: fields.capturedAt,
    });
    if (evidenceError) throw new Error(`insert creator_evidence: ${evidenceError.message}`);

    persisted += 1;
    await updateSearchTask(client, taskId, { persistedCount: persisted, duplicateCount: duplicates, progress: 30 + Math.round((persisted / Math.max(targetCount, 1)) * 60) });
  }

  const partial = persisted < targetCount;
  await updateSearchTask(client, taskId, { status: partial ? "partial" : "completed", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, partialReason: partial ? "source_exhausted" : null, errorCode: null, errorMessage: null });
  const { error: versionError } = await client.from("search_tasks").update({ model_version: "skill-agent-v1", prompt_version: "creator-agent.v1", rule_schema_version: "search-rule.v1" }).eq("id", taskId);
  if (versionError) throw new Error(`update search_tasks versions: ${versionError.message}`);
  await finishJob(pool, { jobId: job.id, userId: job.user_id, status: partial ? "partial" : "completed", stage: "persisting", terminal: true, progress: 100, messageCode: partial ? "SEARCH_PARTIAL" : "SEARCH_COMPLETED", result: { source: "tikhub", collected: collected.length, persisted, duplicates, filtered, requestCount, retryCount } });
}
