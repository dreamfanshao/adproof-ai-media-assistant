import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { run as runSkillsAgent } from "../../agent/run-agent.js";
import { SEMANTIC_SCHEMA_VERSION, computeActivityScore } from "./xhs-semantic-matcher.js";
import { createTikHubXhsClient, type TikHubCreatorProfile } from "./tikhub-xhs-client.js";
import { createTikHubDouyinClient } from "./tikhub-douyin-client.js";
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

interface Candidate {
  platform: "xiaohongshu" | "douyin";
  profile: TikHubCreatorProfile;
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

function canonicalProfileUrl(platform: Candidate["platform"], profile: TikHubCreatorProfile): string {
  if (profile.ref.profileUrl) return profile.ref.profileUrl;
  return platform === "douyin"
    ? "https://www.douyin.com/user/" + profile.ref.platformCreatorId
    : "https://www.xiaohongshu.com/user/profile/" + profile.ref.platformCreatorId;
}

export async function runTikHubMultiPlatformCreatorSearchJob(
  env: WorkerEnv,
  client: SupabaseClient,
  pool: pg.Pool,
  job: SearchJob,
): Promise<void> {
  const payload = job.payload as unknown as SearchJobPayload;
  const {
    search_task_id: taskId,
    project_id: projectId,
    keyword,
    query_text: queryText,
    target_count: targetCount,
    confirmed_rule: confirmedRule,
  } = payload;
  const rule = (confirmedRule ?? {}) as ParsedRule;
  const followersCond = rule.hard_filters?.followers;
  const platforms = Array.from(new Set(payload.platforms ?? ["xiaohongshu"])).filter(
    (platform): platform is Candidate["platform"] => platform === "xiaohongshu" || platform === "douyin",
  );
  const selectedPlatforms = platforms.length ? platforms : ["xiaohongshu" as const];

  if (job.cancel_requested) {
    await updateSearchTask(client, taskId, { status: "cancelled", terminal: true, progress: 100 });
    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "cancelled",
      stage: "queued",
      terminal: true,
      progress: 100,
      messageCode: "SEARCH_CANCELLED",
    });
    return;
  }

  if (!env.TIKHUB_TOKEN) {
    const message = "TikHub 数据源未配置，请在服务端 .env.local 设置 TIKHUB_TOKEN。";
    await updateSearchTask(client, taskId, {
      status: "failed",
      terminal: true,
      progress: 100,
      errorCode: "XHS_TIKHUB_NOT_CONFIGURED",
      errorMessage: message,
    });
    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "failed",
      stage: "collecting",
      terminal: true,
      progress: 100,
      messageCode: "XHS_TIKHUB_NOT_CONFIGURED",
      errorCode: "XHS_TIKHUB_NOT_CONFIGURED",
      errorMessage: message,
      retryable: false,
    });
    return;
  }

  await updateSearchTask(client, taskId, {
    status: "collecting",
    progress: 10,
    stageMessageCode: "SEARCH_COLLECTING_TIKHUB",
  });

  const perPlatformTarget = Math.max(1, Math.ceil(targetCount / selectedPlatforms.length));
  const candidates: Candidate[] = [];
  const sourceErrors: string[] = [];
  let requestCount = 0;
  let retryCount = 0;

  for (const platform of selectedPlatforms) {
    try {
      const result = platform === "douyin"
        ? await createTikHubDouyinClient(env).collectCreatorProfiles(keyword, perPlatformTarget)
        : await createTikHubXhsClient(env).collectCreatorProfiles(keyword, perPlatformTarget);
      candidates.push(...result.profiles.map((profile) => ({ platform, profile })));
      requestCount += result.requestCount;
      retryCount += result.retryCount;
    } catch (error) {
      sourceErrors.push(platform + ": " + errorMessage(error));
    }
  }

  if (!candidates.length) {
    const message = sourceErrors.join("；") || "TikHub 未返回可识别的达人数据。";
    await updateSearchTask(client, taskId, {
      status: "failed",
      terminal: true,
      progress: 100,
      errorCode: "XHS_TIKHUB_REQUEST_FAILED",
      errorMessage: message,
    });
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
      result: { source: selectedPlatforms, collected: 0, requestCount, retryCount },
    });
    return;
  }

  await updateSearchTask(client, taskId, { collectedCount: candidates.length, progress: 30 });

  let persisted = 0;
  let duplicates = 0;
  let filtered = 0;
  for (const candidate of candidates) {
    if (persisted >= targetCount) break;
    const { platform, profile } = candidate;
    const creatorId = profile.ref.platformCreatorId;
    const profileUrl = canonicalProfileUrl(platform, profile);
    const fields = profile.fields;

    const existingCreator = await client
      .from("creators")
      .select("id")
      .eq("platform", platform)
      .eq("platform_creator_id", creatorId)
      .maybeSingle();
    if (existingCreator.data) {
      const existingLink = await client
        .from("project_creators")
        .select("id")
        .eq("project_id", projectId)
        .eq("creator_id", existingCreator.data.id)
        .maybeSingle();
      if (existingLink.data) {
        duplicates += 1;
        continue;
      }
    }

    if (followersCond && (fields.followers === null || !satisfies(fields.followers, followersCond))) {
      filtered += 1;
      continue;
    }

    const agentRun = await runSkillsAgent(queryText ?? keyword, [{
      id: creatorId,
      nickname: fields.nickname ?? "",
      handle: fields.handle ?? undefined,
      profileUrl,
      followers: fields.followers ?? undefined,
      activity: undefined,
      bio: fields.bio ?? undefined,
      posts: fields.posts,
      imageUrls: platform === "xiaohongshu" ? fields.imageUrls : [],
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
      conditions: [{
        condition_id: "agent_semantic_match",
        verdict: match.matched ? "matched" : "not_matched",
        confidence,
        evidence_ids: evidence.map((_, index) => "agent-" + index),
        reason: evidence.join(" | ") || "LLM evidence unavailable",
      }],
      activity: { score: activity.score, posts: fields.posts.length, medianInteraction: activity.medianInteraction },
      matchScore: Number(agentCandidate?.matchScore ?? 0),
      evidenceSummary: evidence.join(" | ") || agentRun.disclaimer,
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      matcher: agentRun.status === "scored" ? "llm" : "pending_llm",
      imageEvidence: platform === "xiaohongshu" ? agentCandidate?.imageEvidence : undefined,
      llmStatus: agentRun.status,
      source: platform,
    };

    const { data: creator, error: creatorError } = await client.from("creators").upsert({
      platform,
      platform_creator_id: creatorId,
      nickname: fields.nickname ?? "未知达人",
      handle: fields.handle,
      profile_url: profileUrl,
      avatar_url: fields.avatarUrl,
      latest_snapshot: { ...fields, source: platform, analysis_mode: platform === "douyin" ? "caption_only" : "multimodal" } as unknown as Record<string, unknown>,
      latest_captured_at: fields.capturedAt,
    }, { onConflict: "platform,platform_creator_id" }).select("id").single();
    if (creatorError || !creator) throw new Error("upsert creator: " + (creatorError?.message ?? "no row"));

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
      analysis_json: {
        semantic: semantic.conditions,
        activity: semantic.activity,
        posts: fields.posts,
        imageUrls: fields.imageUrls,
        llm_status: semantic.llmStatus,
        image_evidence: semantic.imageEvidence,
        matcher: semantic.matcher,
        schema_version: semantic.schemaVersion,
        source: platform,
        analysis_mode: platform === "douyin" ? "caption_only" : "multimodal",
      } as unknown as Record<string, unknown>,
      captured_at: fields.capturedAt,
    }, { onConflict: "project_id,creator_id" }).select("id").single();
    if (linkError || !linkRow) throw new Error("upsert project_creator: " + (linkError?.message ?? "no row"));

    const { error: evidenceError } = await client.from("creator_evidence").insert({
      user_id: job.user_id,
      project_creator_id: linkRow.id,
      evidence_type: "ai_analysis",
      source_url: profileUrl,
      excerpt: semantic.evidenceSummary.slice(0, 2000),
      confidence: semantic.conditions.length ? Math.min(...semantic.conditions.map((value) => value.confidence)) : null,
      captured_at: fields.capturedAt,
    });
    if (evidenceError) throw new Error("insert creator_evidence: " + evidenceError.message);

    persisted += 1;
    await updateSearchTask(client, taskId, {
      persistedCount: persisted,
      duplicateCount: duplicates,
      progress: 30 + Math.round((persisted / Math.max(targetCount, 1)) * 60),
    });
  }

  const partial = persisted < targetCount || sourceErrors.length > 0;
  const partialReason = sourceErrors.length ? "source_partial" : partial ? "source_exhausted" : null;
  await updateSearchTask(client, taskId, {
    status: partial ? "partial" : "completed",
    terminal: true,
    progress: 100,
    persistedCount: persisted,
    duplicateCount: duplicates,
    partialReason,
    errorCode: null,
    errorMessage: sourceErrors.length ? sourceErrors.join("；") : null,
  });
  const { error: versionError } = await client.from("search_tasks").update({
    model_version: "skill-agent-v1",
    prompt_version: "creator-agent.v1",
    rule_schema_version: "search-rule.v1",
  }).eq("id", taskId);
  if (versionError) throw new Error("update search_tasks versions: " + versionError.message);

  await finishJob(pool, {
    jobId: job.id,
    userId: job.user_id,
    status: partial ? "partial" : "completed",
    stage: "persisting",
    terminal: true,
    progress: 100,
    messageCode: partial ? "SEARCH_PARTIAL" : "SEARCH_COMPLETED",
    result: {
      source: selectedPlatforms,
      collected: candidates.length,
      persisted,
      duplicates,
      filtered,
      requestCount,
      retryCount,
      sourceErrors,
    },
  });
}
