import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { run as runSkillsAgent } from "../../agent/run-agent.js";
import type { AgentPlan } from "../../agent/skills/types.js";
import { buildCreatorSearchKeywords } from "./creator-search-keywords.js";
import { chooseSearchLoopAction, expandedCreatorSearchKeywords } from "./creator-search-loop.js";
import { loadOrCreateSearchSession, loadProjectSearchHistory, recordSearchScreenings, saveSearchSessionProgress, seedLegacySearchHistory, type PendingSearchBatch, type SearchScreeningInput } from "./creator-search-session.js";
import { SEMANTIC_SCHEMA_VERSION, computeActivityScore } from "./xhs-semantic-matcher.js";
import { createRedfoxXhsClient, redfoxNoteKey, type RedfoxNoteCandidate, type RedfoxCreatorProfile } from "./redfox-xhs-client.js";
import { finishJob, refreshJobLease, updateSearchTask, type JobExecutionControl, type SearchJob, type SearchJobPayload, type WorkerEnv } from "./xhs-db.js";

interface RuleCondition { field: string; operator: "lt" | "lte" | "gt" | "gte" | "eq"; value: number | string | boolean; }
interface ParsedRule {
  hard_filters?: { followers?: RuleCondition; followers_max?: RuleCondition; posts_last_30d?: RuleCondition; days_since_last_post?: RuleCondition; recent_likes?: RuleCondition; recent_likes_window_days?: number };
  semantic_conditions?: Array<{ id?: string; type?: string; match?: string; terms?: unknown }>;
}

interface SearchStageCounts {
  [key: string]: number;
  notes_collected: number;
  creators_discovered: number;
  candidates_started: number;
  profile_failures: number;
  follower_filtered: number;
  recent_likes_filtered: number;
  posts_last_30d_filtered: number;
  days_since_last_post_filtered: number;
  semantic_filtered: number;
  quality_filtered: number;
  analysis_errors: number;
  existing_duplicates: number;
  persisted: number;
}

type RankedCandidate = {
  note: RedfoxNoteCandidate;
  profile: RedfoxCreatorProfile;
  followersMatched: boolean | null;
  recentLikesMatched: boolean | null;
  postsLast30dMatched: boolean | null;
  daysSinceLastPostMatched: boolean | null;
  noteAnalysis: Awaited<ReturnType<typeof analyzeNote>>;
  activity: ReturnType<typeof computeActivityScore>;
  rankingScore: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Always attempts both terminal writes so a task-update failure cannot leave
 * a running job available for a second Worker claim. */
export async function finalizeSearchExecution(
  finalizeTask: () => Promise<void>,
  finalizeJob: () => Promise<void>,
): Promise<void> {
  const [taskResult, jobResult] = await Promise.allSettled([finalizeTask(), finalizeJob()]);
  if (taskResult.status === "rejected" && jobResult.status === "rejected") {
    throw new AggregateError([taskResult.reason, jobResult.reason], "search task and job finalization both failed");
  }
  if (jobResult.status === "rejected") throw jobResult.reason;
  if (taskResult.status === "rejected") throw taskResult.reason;
}

function normalizeLegacyRule(rule: ParsedRule, query: string): ParsedRule {
  const hard = { ...(rule.hard_filters ?? {}) };
  // 兼容旧任务：历史解析器曾把“近三个月点赞 N 个以上”误存为 posts_last_30d。
  if (!hard.recent_likes && hard.posts_last_30d && /点赞|获赞|互动/.test(query) && !/发帖|发布(?:了)?(?:笔记|内容)|笔记数量/.test(query)) {
    const match = query.match(/(?:点赞|获赞|互动)\s*(?:不少于|大于|超过|>=|至少)?\s*(\d+)/);
    if (match) {
      const windowMatch = query.match(/近\s*(三|3|两|二|2|一|1|四|4|五|5|六|6|七|7|八|8|九|9|十|10)\s*个?月/);
      const token = windowMatch?.[1];
      const months = token ? ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[token] ?? Number(token) : undefined;
      hard.recent_likes = { field: "recent_likes", operator: "gte", value: Number.parseInt(match[1], 10) };
      hard.recent_likes_window_days = /近\s*30\s*天/.test(query) ? 30 : (months ? months * 30 : 30);
      delete hard.posts_last_30d;
    }
  }
  return { ...rule, hard_filters: hard };
}
function canonicalProfileUrl(profileUrl: string, creatorId: string): string {
  const match = profileUrl.match(/\/user\/profile\/([^/?#]+)/i);
  return `https://www.xiaohongshu.com/user/profile/${match?.[1] ?? creatorId}`;
}
function satisfies(value: number, condition: RuleCondition): boolean {
  const target = Number(condition.value);
  switch (condition.operator) { case "lt": return value < target; case "lte": return value <= target; case "gt": return value > target; case "gte": return value >= target; case "eq": return value === target; default: return true; }
}

/** 近期点赞条件按“窗口内至少一篇笔记达到门槛”判断；没有可解析日期时保守使用已返回笔记。 */
export function satisfiesRecentLikes(posts: Array<{ likes?: number | null; publishedAt?: string }>, condition: RuleCondition, windowDays = 90, now = Date.now()): boolean {
  const cutoff = now - Math.max(1, windowDays) * 24 * 60 * 60 * 1000;
  const dated = posts.filter((post) => post.publishedAt && Number.isFinite(Date.parse(post.publishedAt)));
  const recent = dated.length ? dated.filter((post) => Date.parse(post.publishedAt as string) >= cutoff) : posts;
  return recent.some((post) => typeof post.likes === "number" && satisfies(post.likes, condition));
}

export interface CreatorCandidateScoreInput {
  followersMatched: boolean | null;
  recentLikesMatched: boolean | null;
  postsLast30dMatched?: boolean | null;
  daysSinceLastPostMatched?: boolean | null;
  semanticMatched: boolean | null;
  semanticConfidence: number;
  activityScore: number;
  dataComplete: boolean;
}

/**
 * 对已完成基础判断的候选达人计算排序分。排序分不能覆盖粉丝硬门槛，
 * 也不能覆盖 AI 语义、证据和置信度质量门槛。
 */
export function scoreCreatorCandidate(input: CreatorCandidateScoreInput): number {
  const confidence = Math.max(0, Math.min(1, input.semanticConfidence));
  const activity = Math.max(0, Math.min(100, input.activityScore));
  const followers = input.followersMatched === false ? 0 : 25;
  const recentLikes = input.recentLikesMatched === false ? 0 : 15;
  const semantic = input.semanticMatched === true ? 35 + confidence * 10 : input.semanticMatched === null ? 5 : 0;
  const completeness = input.dataComplete ? 5 : 2;
  const activityHardFilterMissed = input.postsLast30dMatched === false || input.daysSinceLastPostMatched === false;
  const activityPoints = activityHardFilterMissed ? 0 : activity * 0.1;
  return Math.max(0, Math.min(100, Math.round(followers + recentLikes + semantic + activityPoints + completeness)));
}

export function selectTopCreatorCandidates<T extends { rankingScore: number }>(candidates: T[], target: number): T[] {
  return [...candidates]
    .sort((left, right) => right.rankingScore - left.rankingScore)
    .slice(0, Math.max(0, Math.floor(target)));
}

export interface CreatorQualityPolicy {
  minimumOverallScore: number;
  minimumSemanticConfidence: number;
  requireEvidence: boolean;
  maximumRelaxedHardConditions: number;
  source: "ai" | "default";
}

const DEFAULT_CREATOR_QUALITY_POLICY: CreatorQualityPolicy = {
  minimumOverallScore: 60,
  minimumSemanticConfidence: 0.62,
  requireEvidence: true,
  maximumRelaxedHardConditions: 1,
  source: "default",
};

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

/**
 * Reads the quality floor proposed by the intent model, while keeping a
 * deterministic safety envelope. The model may make a precise query stricter,
 * but it cannot disable semantic evidence or allow arbitrary filter relaxation.
 */
export function creatorQualityPolicyFromIntent(value: unknown): CreatorQualityPolicy {
  const intent = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = (intent.qualityPolicy ?? intent.quality_policy) as Record<string, unknown> | undefined;
  const hasAiThreshold = Number.isFinite(Number(raw?.minimumOverallScore ?? raw?.minimum_overall_score))
    || Number.isFinite(Number(raw?.minimumSemanticConfidence ?? raw?.minimum_semantic_confidence));
  return {
    minimumOverallScore: boundedNumber(
      raw?.minimumOverallScore ?? raw?.minimum_overall_score,
      DEFAULT_CREATOR_QUALITY_POLICY.minimumOverallScore,
      55,
      70,
    ),
    minimumSemanticConfidence: boundedNumber(
      raw?.minimumSemanticConfidence ?? raw?.minimum_semantic_confidence,
      DEFAULT_CREATOR_QUALITY_POLICY.minimumSemanticConfidence,
      0.55,
      0.85,
    ),
    requireEvidence: DEFAULT_CREATOR_QUALITY_POLICY.requireEvidence,
    maximumRelaxedHardConditions: 1,
    source: hasAiThreshold ? "ai" : "default",
  };
}

export function passesCreatorQualityGate(input: {
  semanticRequired: boolean;
  semanticMatched: boolean | null;
  semanticConfidence: number;
  semanticEvidenceCount: number;
  rankingScore: number;
  qualityPolicy: CreatorQualityPolicy;
}): { passed: boolean; reason: string | null } {
  if (!input.semanticRequired) return { passed: true, reason: null };
  if (input.semanticMatched === null) return { passed: false, reason: "SEMANTIC_ANALYSIS_REQUIRED" };
  if (input.semanticMatched !== true) return { passed: false, reason: "SEMANTIC_NOT_MATCHED" };
  if (input.semanticConfidence < input.qualityPolicy.minimumSemanticConfidence) {
    return { passed: false, reason: "SEMANTIC_CONFIDENCE_BELOW_MINIMUM" };
  }
  if (input.qualityPolicy.requireEvidence && input.semanticEvidenceCount < 1) {
    return { passed: false, reason: "SEMANTIC_EVIDENCE_REQUIRED" };
  }
  if (input.rankingScore < input.qualityPolicy.minimumOverallScore) {
    return { passed: false, reason: "MINIMUM_QUALITY_SCORE" };
  }
  return { passed: true, reason: null };
}

export type RelaxableHardFilter = "recent_likes" | "posts_last_30d" | "days_since_last_post";
export type CreatorHardFilter = "followers" | RelaxableHardFilter;

export function selectDominantHardFilter(input: {
  followersEnabled: boolean;
  recentLikesEnabled: boolean;
  postsLast30dEnabled?: boolean;
  daysSinceLastPostEnabled?: boolean;
  followerFailures: number;
  recentLikesFailures: number;
  postsLast30dFailures?: number;
  daysSinceLastPostFailures?: number;
}): RelaxableHardFilter | null {
  const candidates: Array<{ filter: RelaxableHardFilter; failures: number; tiePriority: number }> = [];
  // Followers are intentionally absent: creator size is identity-defining and
  // must never be converted into a ranking-only signal.
  if (input.recentLikesEnabled) candidates.push({ filter: "recent_likes", failures: input.recentLikesFailures, tiePriority: 0 });
  if (input.postsLast30dEnabled) candidates.push({ filter: "posts_last_30d", failures: input.postsLast30dFailures ?? 0, tiePriority: 1 });
  if (input.daysSinceLastPostEnabled) candidates.push({ filter: "days_since_last_post", failures: input.daysSinceLastPostFailures ?? 0, tiePriority: 2 });
  const selected = candidates
    .filter((item) => item.failures > 0)
    .sort((left, right) => right.failures - left.failures || left.tiePriority - right.tiePriority)[0];
  return selected?.filter ?? null;
}

export function passesCandidateGates(input: {
  followersEnabled: boolean;
  recentLikesEnabled: boolean;
  postsLast30dEnabled?: boolean;
  daysSinceLastPostEnabled?: boolean;
  semanticRequired: boolean;
  followersMatched: boolean | null;
  recentLikesMatched: boolean | null;
  postsLast30dMatched?: boolean | null;
  daysSinceLastPostMatched?: boolean | null;
  semanticMatched: boolean | null;
  semanticConfidence?: number;
  semanticEvidenceCount?: number;
  rankingScore?: number;
  qualityPolicy?: CreatorQualityPolicy;
  relaxedHardFilter: RelaxableHardFilter | null;
  relaxedHardFilters?: ReadonlySet<RelaxableHardFilter>;
}): { passed: boolean; reason: string | null } {
  const relaxed = input.relaxedHardFilters ?? (input.relaxedHardFilter ? new Set([input.relaxedHardFilter]) : new Set<RelaxableHardFilter>());
  if (input.followersEnabled && input.followersMatched !== true) {
    return { passed: false, reason: "FOLLOWERS_HARD_FILTER" };
  }
  if (input.recentLikesEnabled && input.recentLikesMatched !== true && !relaxed.has("recent_likes")) {
    return { passed: false, reason: "RECENT_LIKES_HARD_FILTER" };
  }
  if (input.postsLast30dEnabled && input.postsLast30dMatched !== true && !relaxed.has("posts_last_30d")) {
    return { passed: false, reason: "POSTS_LAST_30D_HARD_FILTER" };
  }
  if (input.daysSinceLastPostEnabled && input.daysSinceLastPostMatched !== true && !relaxed.has("days_since_last_post")) {
    return { passed: false, reason: "DAYS_SINCE_LAST_POST_HARD_FILTER" };
  }
  if (input.qualityPolicy) {
    return passesCreatorQualityGate({
      semanticRequired: input.semanticRequired,
      semanticMatched: input.semanticMatched,
      semanticConfidence: input.semanticConfidence ?? 0,
      semanticEvidenceCount: input.semanticEvidenceCount ?? 0,
      rankingScore: input.rankingScore ?? 0,
      qualityPolicy: input.qualityPolicy,
    });
  }
  if (input.semanticRequired && input.semanticMatched !== true) {
    return { passed: false, reason: input.semanticMatched === null ? "SEMANTIC_ANALYSIS_REQUIRED" : "SEMANTIC_NOT_MATCHED" };
  }
  return { passed: true, reason: null };
}

export function recentPostMetrics(posts: Array<{ publishedAt?: string }>, now = Date.now()): {
  postsLast30d: number;
  daysSinceLastPost: number | null;
} {
  const timestamps = posts
    .map((post) => post.publishedAt ? Date.parse(post.publishedAt) : Number.NaN)
    .filter((timestamp) => Number.isFinite(timestamp));
  const cutoff = now - 30 * 86_400_000;
  const latest = timestamps.length ? Math.max(...timestamps) : null;
  return {
    postsLast30d: timestamps.filter((timestamp) => timestamp >= cutoff && timestamp <= now).length,
    daysSinceLastPost: latest === null ? null : Math.max(0, Math.floor((now - latest) / 86_400_000)),
  };
}
function candidateForNote(note: RedfoxNoteCandidate, query: string, source: string, profile?: RedfoxCreatorProfile) {
  const profilePosts = profile?.fields.posts ?? [];
  const posts = [
    { title: note.title, text: note.text, likes: note.likes, interaction: note.interaction, publishedAt: note.publishedAt, imageUrls: note.imageUrls },
    ...profilePosts.filter((post) => post.title !== note.title || post.interaction !== note.interaction),
  ];
  return {
    id: note.noteId ?? note.userId + ":" + note.title,
    nickname: profile?.fields.nickname ?? note.nickname ?? "",
    handle: profile?.fields.handle ?? note.handle ?? undefined,
    profileUrl: profile?.ref.profileUrl ?? note.profileUrl,
    bio: profile?.fields.bio ?? undefined,
    followers: profile?.fields.followers ?? undefined,
    activity: profile ? computeActivityScore(profile.fields.posts).score : undefined,
    posts,
    imageUrls: profile?.fields.imageUrls?.length ? profile.fields.imageUrls : note.imageUrls,
    source,
    query,
  };
}

function notePreferenceScore(note: RedfoxNoteCandidate, now = Date.now()): number {
  const published = note.publishedAt ? Date.parse(note.publishedAt) : Number.NaN;
  const recent = Number.isFinite(published) && published >= now - 90 * 86_400_000 ? 1 : 0;
  const personal = /(?:我|本人|亲测|体验|日记|记录|术后|恢复|做完|皮肤)/.test(`${note.title} ${note.text}`) ? 1 : 0;
  return recent * 1_000_000_000 + Math.max(0, note.likes ?? 0) * 100_000 + personal * 10_000 + Math.min(note.text.length, 9_999);
}

export function selectRepresentativeNotes(notes: RedfoxNoteCandidate[]): RedfoxNoteCandidate[] {
  const byCreator = new Map<string, RedfoxNoteCandidate>();
  for (const note of notes) {
    const current = byCreator.get(note.userId);
    if (!current || notePreferenceScore(note) > notePreferenceScore(current)) byCreator.set(note.userId, note);
  }
  return [...byCreator.values()].sort((left, right) => notePreferenceScore(right) - notePreferenceScore(left));
}

async function existingProjectCreatorIds(client: SupabaseClient, projectId: string, platformCreatorIds: string[]): Promise<Set<string>> {
  const result = new Set<string>();
  if (!platformCreatorIds.length) return result;
  const creatorRows: Array<{ id: string; platform_creator_id: string }> = [];
  for (let offset = 0; offset < platformCreatorIds.length; offset += 80) {
    const chunk = platformCreatorIds.slice(offset, offset + 80);
    const { data, error } = await client.from("creators").select("id,platform_creator_id").eq("platform", "xiaohongshu").in("platform_creator_id", chunk);
    if (error) return new Set();
    creatorRows.push(...((data ?? []) as Array<{ id: string; platform_creator_id: string }>));
  }
  if (!creatorRows.length) return result;
  const creatorIdToPlatformId = new Map(creatorRows.map((row) => [row.id, row.platform_creator_id]));
  for (let offset = 0; offset < creatorRows.length; offset += 80) {
    const chunk = creatorRows.slice(offset, offset + 80).map((row) => row.id);
    const { data, error } = await client.from("project_creators").select("creator_id").eq("project_id", projectId).in("creator_id", chunk);
    if (error) return new Set();
    for (const row of data ?? []) {
      const platformId = creatorIdToPlatformId.get(String(row.creator_id));
      if (platformId) result.add(platformId);
    }
  }
  return result;
}

async function existingSearchTaskCreatorCount(client: SupabaseClient, taskId: string): Promise<number> {
  const { count, error } = await client
    .from("project_creators")
    .select("id", { count: "exact", head: true })
    .eq("search_task_id", taskId);
  if (error) throw new Error(`count existing search-task creators: ${error.message}`);
  return Math.max(0, Number(count ?? 0));
}

export function isProviderBudgetExhausted(message: string | null): boolean {
  return Boolean(message && /积分余额不足|余额不足|剩余积分\s*0(?:\.0)?|RedFox 调用上限|API\s*Key.*(?:禁用|无效|过期)|密钥.*(?:禁用|无效|过期)/i.test(message));
}

export function isProviderCredentialError(message: string | null): boolean {
  return Boolean(message && /API\s*Key.*(?:禁用|无效|过期)|密钥.*(?:禁用|无效|过期)/i.test(message));
}

export function creatorSearchBudgetStopMessage(message: string, persisted: number, target: number): string {
  if (/API\s*Key.*禁用|密钥.*禁用/i.test(message)) {
    return `RedFoxHub API Key 已禁用，任务已立即停止；当前新增 ${persisted}/${target} 人。请更换可用 Key 后重试。`;
  }
  if (/API\s*Key.*(?:无效|过期)|密钥.*(?:无效|过期)/i.test(message)) {
    return `RedFoxHub API Key 无效或已过期，任务已立即停止；当前新增 ${persisted}/${target} 人。请更换可用 Key 后重试。`;
  }
  if (/积分余额不足|余额不足|剩余积分\s*0(?:\.0)?/.test(message)) {
    return `RedFoxHub 积分余额不足，已保存检索位置；当前新增 ${persisted}/${target} 人。充值后再次点击“开始检索”会从当前位置继续，不会重复筛查历史达人。`;
  }
  return `本次任务达到本地安全调用上限，已保存检索位置；当前新增 ${persisted}/${target} 人。再次点击“开始检索”会从当前位置继续。`;
}

export function creatorSearchPartialMessage(stageCounts: SearchStageCounts, target: number): string {
  const checked = stageCounts.creators_discovered;
  const followerDataMissing = stageCounts.follower_data_missing ?? 0;
  const followerOutOfRange = Math.max(0, stageCounts.follower_filtered - followerDataMissing);
  const parts = [
    followerOutOfRange > 0 ? `${followerOutOfRange} 个粉丝范围未达` : "",
    followerDataMissing > 0 ? `${followerDataMissing} 个粉丝数据缺失` : "",
    stageCounts.recent_likes_filtered > 0 ? `${stageCounts.recent_likes_filtered} 个近期点赞条件未达` : "",
    stageCounts.posts_last_30d_filtered > 0 ? `${stageCounts.posts_last_30d_filtered} 个近 30 天发帖数条件未达` : "",
    stageCounts.days_since_last_post_filtered > 0 ? `${stageCounts.days_since_last_post_filtered} 个最近发帖时间条件未达` : "",
    stageCounts.semantic_filtered > 0 ? `${stageCounts.semantic_filtered} 个内容语义条件未达` : "",
    stageCounts.profile_failures > 0 ? `${stageCounts.profile_failures} 个资料或作品暂不可用` : "",
    stageCounts.analysis_errors > 0 ? `${stageCounts.analysis_errors} 个模型分析未完成` : "",
    stageCounts.existing_duplicates > 0 ? `${stageCounts.existing_duplicates} 个项目历史重复` : "",
  ].filter(Boolean);
  const details = parts.length ? `；其中${parts.join("，")}` : "";
  return `本次检查 ${checked} 个账号${details}；新增 ${stageCounts.persisted}/${target} 人。粉丝范围始终作为不可放宽的前置条件；系统最多放宽一个近期点赞或活跃度条件，且 AI 语义匹配、有效证据和综合分门槛保持不变。`;
}

export function creatorSearchQualityPartialMessage(stageCounts: SearchStageCounts, target: number): string {
  return `本次检查 ${stageCounts.creators_discovered} 个账号；${stageCounts.quality_filtered} 个候选未达到 AI 最低匹配标准，最终新增 ${stageCounts.persisted}/${target} 人。系统没有使用低质量候选补足 20 人；可继续扩大数据源范围，最低语义质量、有效证据和综合分门槛不会放宽。`;
}

export function creatorSearchLoopPolicy(
  maxRounds: unknown,
): { maxRounds: number | null; requestLimit: null; stopMode: "quality_yield" } {
  const configuredRounds = Number(maxRounds);
  return {
    maxRounds: Number.isFinite(configuredRounds) && configuredRounds > 0
      ? Math.max(1, Math.min(100, Math.floor(configuredRounds)))
      : null,
    requestLimit: null,
    stopMode: "quality_yield",
  };
}

export function creatorCandidateAnalysisLimit(target: number, eligible: number, remainingBudget: number): number {
  const remainingTarget = Math.max(1, Math.floor(target) - Math.max(0, Math.floor(eligible)));
  // Analyze a focused, relevance-sorted tranche. Later ReAct rounds can change
  // keywords or soften one dominant data condition instead of spending on a
  // large low-yield batch in one pass.
  return Math.max(0, Math.min(24, remainingTarget + 8, Math.max(0, Math.floor(remainingBudget))));
}

export function passesSemanticPreflight(input: {
  semanticRequired: boolean;
  analysisComplete: boolean;
  matched: boolean;
  confidence: number;
  evidenceCount: number;
  qualityPolicy: CreatorQualityPolicy;
}): boolean {
  if (!input.semanticRequired) return true;
  return input.analysisComplete
    && input.matched
    && input.confidence >= input.qualityPolicy.minimumSemanticConfidence
    && (!input.qualityPolicy.requireEvidence || input.evidenceCount > 0);
}

export function searchMaxDurationMs(raw: unknown): number {
  const configured = Number(raw);
  return Number.isFinite(configured) && configured > 0
    ? Math.max(60_000, configured)
    : Number.POSITIVE_INFINITY;
}

export function creatorSearchWavePlan(target: number, persisted: number, keywordCount: number): {
  desiredCreators: number;
  pageBudget: number;
  minimumPages: number;
} {
  const remaining = Math.max(1, Math.floor(target) - Math.max(0, Math.floor(persisted)));
  // 分批建立候选池，避免首轮一次性拉取并串行分析 80 人导致页面长时间运行。
  const desiredCreators = Math.min(40, Math.max(20, remaining * 2));
  const minimumPages = persisted === 0 ? Math.max(1, Math.min(4, Math.max(1, keywordCount))) : 1;
  return {
    desiredCreators,
    pageBudget: Math.max(minimumPages, Math.min(Math.max(1, keywordCount), Math.ceil(desiredCreators / 20))),
    minimumPages,
  };
}

export function shouldContinueCreatorSearch(input: {
  persisted: number;
  target: number;
  sourceExhausted: boolean;
  providerBudgetError?: string | null;
}): boolean {
  return input.persisted < input.target && !input.sourceExhausted && !input.providerBudgetError;
}

function searchProgress(loopIteration: number, maxRounds: number | null, persisted: number, target: number): number {
  const progressRounds = maxRounds ?? Math.max(6, target);
  const loopProgress = Math.max(0, Math.min(1, loopIteration / Math.max(1, progressRounds)));
  const resultProgress = Math.max(0, Math.min(1, persisted / Math.max(1, target)));
  return 25 + Math.min(65, Math.round(Math.max(loopProgress * 36, resultProgress * 65)));
}

function evidenceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

export function creatorSemanticAnalysisQuery(query: string, rule: ParsedRule): string {
  const semanticConditions = rule.semantic_conditions ?? [];
  if (!semanticConditions.length) return query;
  return [
    "仅判断候选内容和账号主体是否符合语义条件；粉丝数、点赞数、发帖数和时间窗口由代码另行判断，不要因这些字段缺失而判语义不匹配。",
    "严格遵守条件中的 match 逻辑：match=any 时命中任意一个主题即可，不要求同时命中全部主题。",
    `语义条件：${JSON.stringify(semanticConditions)}`,
  ].join("\n");
}

async function analyzeNote(query: string, note: RedfoxNoteCandidate, source: string, sharedPlan?: AgentPlan, profile?: RedfoxCreatorProfile) {
  try {
    const run = await runSkillsAgent(query, [candidateForNote(note, query, source, profile)], sharedPlan);
    const candidate = run.candidates[0] as { semanticMatch?: { matched?: boolean; confidence?: number; evidence?: string[]; reasons?: string[] }; imageEvidence?: unknown; matchScore?: number } | undefined;
    const match = candidate?.semanticMatch ?? {};
    const semanticStep = run.steps.find((item) => item.capabilityId === "creator_semantic_matching");
    const analysisComplete = semanticStep?.status === "completed" && typeof match.matched === "boolean";
    const evidence = evidenceList(match.evidence);
    const reasons = evidenceList(match.reasons);
    return { run, candidate, analysisComplete, matched: analysisComplete && match.matched === true, confidence: Math.max(0, Math.min(1, Number(match.confidence ?? 0))), evidence, reasons, imageEvidence: candidate?.imageEvidence, matchScore: Number(candidate?.matchScore ?? 0) };
  } catch (error) {
    return { run: null, candidate: undefined, analysisComplete: false, matched: false, confidence: 0, evidence: [`模型分析异常：${errorMessage(error)}`], imageEvidence: undefined, matchScore: 0 };
  }
}

async function persistRankedCandidates(input: {
  client: SupabaseClient;
  userId: string;
  projectId: string;
  taskId: string;
  provider: string;
  searchKeywords: string[];
  softenedHardFilters: ReadonlySet<RelaxableHardFilter>;
  candidates: RankedCandidate[];
}): Promise<{ persisted: number; screenings: SearchScreeningInput[] }> {
  const screenings: SearchScreeningInput[] = [];
  let persisted = 0;
  for (const ranked of input.candidates) {
    const { note, profile, followersMatched, recentLikesMatched, postsLast30dMatched, daysSinceLastPostMatched, noteAnalysis, activity, rankingScore } = ranked;
    const fields = profile.fields;
    const stableProfileUrl = canonicalProfileUrl(profile.ref.profileUrl, profile.ref.platformCreatorId);
    const evidence = noteAnalysis.evidence;
    const scoreEvidence = [
      `综合评分 ${rankingScore}`,
      input.softenedHardFilters.size ? `已软化条件：${[...input.softenedHardFilters].join("、")}` : "",
      followersMatched === false ? "粉丝条件未达，已由评分降权" : "",
      recentLikesMatched === false ? "近期点赞条件未达，已由评分降权" : "",
      postsLast30dMatched === false ? "近30天发帖条件未达，已由评分降权" : "",
      daysSinceLastPostMatched === false ? "最近发帖时间条件未达，已由评分降权" : "",
      ...evidence,
    ].filter(Boolean);
    const semantic = {
      conditions: [{ condition_id: "redfox_note_semantic_match", verdict: noteAnalysis.analysisComplete ? (noteAnalysis.matched ? "matched" : "not_matched") : "review", confidence: noteAnalysis.confidence, evidence_ids: evidence.map((_, i) => `redfox-${i}`), reason: scoreEvidence.join(" | ") }],
      activity: { score: activity.score, posts: fields.posts.length, medianInteraction: activity.medianInteraction },
      matchScore: rankingScore,
      evidenceSummary: scoreEvidence.join(" | ") || "综合评分保留，等待人工复核。",
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      matcher: noteAnalysis.analysisComplete ? "llm_weighted_ranking" : "weighted_fallback",
      imageEvidence: noteAnalysis.imageEvidence,
      llmStatus: noteAnalysis.analysisComplete ? "scored" : noteAnalysis.run?.status ?? "error",
      source: input.provider,
      searchKeywords: input.searchKeywords,
    };
    const { data: creator, error: creatorError } = await input.client.from("creators").upsert({ platform: "xiaohongshu", platform_creator_id: profile.ref.platformCreatorId, nickname: fields.nickname ?? "未命名达人", handle: fields.handle, profile_url: stableProfileUrl, avatar_url: fields.avatarUrl, latest_snapshot: { ...fields, source: input.provider, matched_note_id: note.noteId } as unknown as Record<string, unknown>, latest_captured_at: fields.capturedAt }, { onConflict: "platform,platform_creator_id" }).select("id").single();
    if (creatorError || !creator) throw new Error(`upsert creator: ${creatorError?.message ?? "no row"}`);
    const { data: linkRow, error: linkError } = await input.client.from("project_creators").upsert({ user_id: input.userId, project_id: input.projectId, creator_id: creator.id, search_task_id: input.taskId, decision_status: "pending", contact_status: "not_contacted", followers: fields.followers, activity_score: semantic.activity.score, match_score: semantic.matchScore, data_completeness: fields.dataCompleteness, field_warnings: fields.warnings as unknown as unknown[], evidence_summary: semantic.evidenceSummary, analysis_json: { semantic: semantic.conditions, activity: semantic.activity, posts: fields.posts, imageUrls: fields.imageUrls, llm_status: semantic.llmStatus, image_evidence: semantic.imageEvidence, matcher: semantic.matcher, schema_version: semantic.schemaVersion, source: input.provider, note_id: note.noteId, note_text: note.text } as unknown as Record<string, unknown>, captured_at: fields.capturedAt }, { onConflict: "project_id,creator_id" }).select("id").single();
    if (linkError || !linkRow) throw new Error(`upsert project_creator: ${linkError?.message ?? "no row"}`);
    const { error: evidenceError } = await input.client.from("creator_evidence").insert({ user_id: input.userId, project_creator_id: linkRow.id, evidence_type: "ai_analysis", source_url: note.noteId ? `https://www.xiaohongshu.com/explore/${note.noteId}` : stableProfileUrl, excerpt: semantic.evidenceSummary.slice(0, 2000), confidence: noteAnalysis.confidence, captured_at: fields.capturedAt });
    if (evidenceError) throw new Error(`insert creator_evidence: ${evidenceError.message}`);
    persisted += 1;
    screenings.push({ creatorPlatformId: note.userId, noteKey: redfoxNoteKey(note), noteId: note.noteId, disposition: "accepted", reasonCode: "ACCEPTED", nextEligibleAt: null });
  }
  return { persisted, screenings };
}

export async function runRedfoxCreatorSearchJob(env: WorkerEnv, client: SupabaseClient, pool: pg.Pool, job: SearchJob): Promise<void> {
  const executionStartedAt = Date.now();
  // No task-level wall-clock cutoff by default: continue until the target,
  // source exhaustion, provider budget/limit, or explicit cancellation. An
  // operator can still opt into a cap with REDFOX_SEARCH_MAX_DURATION_MS.
  const maxDurationMs = searchMaxDurationMs(env.REDFOX_SEARCH_MAX_DURATION_MS);
  const payload = job.payload as unknown as SearchJobPayload;
  const { search_task_id: taskId, project_id: projectId, keyword, query_text: queryText, target_count: targetCount, confirmed_rule } = payload;
  const rule = normalizeLegacyRule((confirmed_rule ?? {}) as ParsedRule, String(queryText ?? keyword ?? ""));
  const provider = "redfox" as const;
  const runtimeDiagnostics: Record<string, unknown> = {
    workerVersion: env.WORKER_RUNTIME_VERSION ?? "unknown",
    keySource: env.REDFOX_API_KEY_SOURCE ?? "unknown",
    keyFingerprint: env.REDFOX_API_KEY_FINGERPRINT ?? null,
    searchEndpoint: env.REDFOX_CREATOR_SEARCH_PATH ?? "/story/api/xhs/ability/searchWork",
  };
  const followersCond = rule.hard_filters?.followers;
  const followersMaxCond = rule.hard_filters?.followers_max;
  const followersEnabled = Boolean(followersCond || followersMaxCond);
  const recentLikesEnabled = Boolean(rule.hard_filters?.recent_likes);
  const postsLast30dEnabled = Boolean(rule.hard_filters?.posts_last_30d);
  const daysSinceLastPostEnabled = Boolean(rule.hard_filters?.days_since_last_post);
  const semanticRequired = Boolean(rule.semantic_conditions?.length || String(queryText ?? keyword ?? "").trim());
  const currentExecutionControl = async (): Promise<JobExecutionControl | "timeout"> => {
    if (Number.isFinite(maxDurationMs) && Date.now() - executionStartedAt >= maxDurationMs) return "timeout";
    if (!job.locked_by) return "continue";
    return refreshJobLease(pool, job.id, job.locked_by);
  };
  const finishCancelled = async (stage: string): Promise<void> => {
    await finalizeSearchExecution(
      () => updateSearchTask(client, taskId, { status: "cancelled", terminal: true, progress: 100, partialReason: "user_cancelled", errorCode: null, errorMessage: null }),
      () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: "cancelled", stage, terminal: true, progress: 100, messageCode: "SEARCH_CANCELLED" }),
    );
  };
  if (job.cancel_requested) {
    await finishCancelled("queued");
    return;
  }
  const configuredApiKey = env.REDFOX_API_KEY;
  if (!configuredApiKey || configuredApiKey.startsWith("REPLACE_WITH_")) {
    const message = "RedFoxHub data source is not configured. Set REDFOX_API_KEY in .env.local.";
    await finalizeSearchExecution(
      () => updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", errorMessage: message }),
      () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", errorCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", retryable: false }),
    );
    return;
  }

  const query = queryText?.trim() || keyword;
  await updateSearchTask(client, taskId, { status: "collecting", progress: 5, stageMessageCode: "SEARCH_ANALYZING_INTENT" });
  let structuredIntent: unknown;
  try {
    const intentPlan: AgentPlan = { planner: "deterministic-fallback", steps: [{ id: "intent", capabilityType: "skill", capabilityId: "creator_intent_structuring", purpose: "提取达人检索关键词" }] };
    const intentRun = await runSkillsAgent(query, [], intentPlan);
    structuredIntent = intentRun.structuredQuery;
  } catch {
    structuredIntent = undefined;
  }
  const qualityPolicy = creatorQualityPolicyFromIntent(structuredIntent);
  const semanticAnalysisQuery = creatorSemanticAnalysisQuery(query, rule);
  let searchKeywords = buildCreatorSearchKeywords({
    query,
    fallbackKeyword: keyword,
    confirmedRule: rule,
    structuredIntent,
    // Start with one compact set of concrete topics. ReAct expansion adds the
    // remaining phrase variants only after observing low yield, which keeps the
    // first wave fast while still allowing the source to be exhausted.
    maxKeywords: 16,
  });

  const batchTarget = Math.min(20, Math.max(1, Number(targetCount) || 20));
  const searchPolicy = creatorSearchLoopPolicy(
    env.REDFOX_AUTO_CONTINUE_MAX_ROUNDS,
  );
  // No local RedFox request ceiling: the ReAct policy stops on result quality,
  // target completion, source exhaustion, cancellation, or provider feedback.
  const collector = createRedfoxXhsClient({
    ...env,
    REDFOX_MAX_REQUESTS_PER_SEARCH: "0",
  });
  const session = await loadOrCreateSearchSession(client, { userId: job.user_id, projectId, query, rule, keywords: searchKeywords });
  await seedLegacySearchHistory(pool, client, { sessionId: session.id, taskId, userId: job.user_id, projectId });
  const history = await loadProjectSearchHistory(client, projectId);
  const existingPersisted = await existingSearchTaskCreatorCount(client, taskId);
  let pendingBatch: PendingSearchBatch | null = session.pending ?? null;
  let cursor = session.cursor;
  let sourceExhausted = session.sourceExhausted;
  let keywordFailures: Array<{ keyword: string; page: number; error: string }> = [];

  const sharedPlan: AgentPlan = {
    planner: "deterministic-fallback",
    note: "检索执行链固定，无需等待 LLM Planner。",
    steps: [
      { id: "load", capabilityType: "tool", capabilityId: "load_candidates", purpose: "加载候选" },
      { id: "dedupe", capabilityType: "tool", capabilityId: "dedupe_candidates", purpose: "候选去重" },
      { id: "account", capabilityType: "skill", capabilityId: "creator_personal_account_assessment", purpose: "判断个人博主或机构账号" },
      { id: "experience", capabilityType: "skill", capabilityId: "creator_experience_evidence", purpose: "识别本人项目经历或皮肤困扰证据" },
      { id: "match", capabilityType: "skill", capabilityId: "creator_semantic_matching", purpose: "综合账号类型、本人经历和主题完成匹配" },
      { id: "rank", capabilityType: "tool", capabilityId: "rank_candidates", purpose: "候选排序" },
    ],
  };
  const needsActivityHistory = Boolean(rule.hard_filters?.posts_last_30d || rule.hard_filters?.days_since_last_post) || /\u6d3b\u8dc3|\u66f4\u65b0\u9891\u7387/.test(query);
  const stageCounts: SearchStageCounts = {
    notes_collected: 0,
    creators_discovered: 0,
    candidates_started: 0,
    profile_failures: 0,
    follower_filtered: 0,
    follower_data_missing: 0,
    recent_likes_filtered: 0,
    posts_last_30d_filtered: 0,
    days_since_last_post_filtered: 0,
    semantic_filtered: 0,
    quality_filtered: 0,
    analysis_errors: 0,
    existing_duplicates: 0,
    persisted: existingPersisted,
  };
  await updateSearchTask(client, taskId, {
    status: "collecting",
    collectedCount: 0,
    persistedCount: existingPersisted,
    stageCounts,
    loopState: { version: "creator-search-loop-v3", iteration: 0, action: "collecting", softened_filters: [], candidate_pool: 0, eligible_candidates: 0, quality_policy: qualityPolicy, last_observation: null },
    progress: 25,
    stageMessageCode: "SEARCH_HARD_FILTERING",
  });
  let persisted = existingPersisted;
  let duplicates = 0;
  let filtered = 0;
  let analysisErrors = 0;
  let upstreamErrors = 0;
  let semanticAttempts = 0;
  let providerBudgetError: string | null = null;
  const softenedHardFilters = new Set<RelaxableHardFilter>();
  let relaxedHardFilter: RelaxableHardFilter | null = null;
  let loopIteration = 0;
  let consecutiveNoGainRounds = 0;
  let keywordExpansionCount = 0;
  let eligibleCandidateCount = 0;
  let loopStopReason: string | null = null;
  let timedOut = false;
  const rejections: Array<{ creatorId: string; nickname: string | null; reason: string; detail?: string }> = [];
  const seenUsers = new Set<string>();
  const candidatePool = new Map<string, RankedCandidate>();
  // The loop controller can request a larger page budget for the next wave
  // after observing low yield. Keep this separate from the static wave plan.
  let nextPageBudget = 1;
  // `persisted` is the only completion counter. `eligibleCandidateCount` is a
  // temporary in-memory pool and must never be added to it, otherwise a saved
  // candidate can be counted twice and a target-20 search can stop early.
  while (!loopStopReason && shouldContinueCreatorSearch({ persisted, target: batchTarget, sourceExhausted: sourceExhausted && !pendingBatch?.notes.length, providerBudgetError })) {
    loopIteration += 1;
    const waveControl = await currentExecutionControl();
    if (waveControl === "cancelled") {
      await finishCancelled("collecting");
      return;
    }
    if (waveControl === "lease_lost") return;
    if (waveControl === "timeout") {
      timedOut = true;
      break;
    }
    const cursorBeforeWave = cursor;
    const candidatePoolSizeBeforeWave = candidatePool.size;
    const eligibleCountBeforeWave = eligibleCandidateCount;
    const wavePlan = creatorSearchWavePlan(batchTarget, persisted, searchKeywords.length);
    let batch: Awaited<ReturnType<typeof collector.searchNextNoteBatch>>;
    let candidateNotes: RedfoxNoteCandidate[];
    if (pendingBatch?.notes.length) {
      batch = {
        notes: pendingBatch.notes,
        pages: 0,
        keywords: searchKeywords,
        keywordFailures: [],
        cursor: pendingBatch.cursor,
        sourceExhausted: pendingBatch.sourceExhausted,
        requestCount: 0,
        retryCount: 0,
        cacheHitCount: 0,
        requestCountByEndpoint: {},
      };
      candidateNotes = pendingBatch.notes;
    } else {
      try {
        batch = await collector.searchNextNoteBatch(searchKeywords, {
          cursor,
          excludedNoteKeys: history.noteKeys,
          excludedCreatorIds: new Set([...history.creatorIds, ...candidatePool.keys(), ...seenUsers]),
          desiredCreators: wavePlan.desiredCreators,
          pageBudget: Math.max(wavePlan.pageBudget, nextPageBudget),
          minimumPages: wavePlan.minimumPages,
        });
      } catch (error) {
        const message = errorMessage(error);
        if (isProviderBudgetExhausted(message)) {
          providerBudgetError = message;
          break;
        }
        await finalizeSearchExecution(
          () => updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", errorMessage: message }),
          () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", errorCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", retryable: true, retryAfterSeconds: 60, result: { source: provider, runtimeDiagnostics, searchKeywords, sessionId: session.id, ...collector.getMetrics() } }),
        );
        return;
      }
      keywordFailures.push(...batch.keywordFailures);
      const budgetFailure = batch.keywordFailures.find((item) => isProviderBudgetExhausted(item.error));
      if (budgetFailure) {
        providerBudgetError = budgetFailure.error;
        break;
      }
      candidateNotes = selectRepresentativeNotes(batch.notes);
      pendingBatch = { notes: candidateNotes, cursor: batch.cursor, sourceExhausted: batch.sourceExhausted };
      stageCounts.notes_collected += batch.notes.length;
      stageCounts.creators_discovered += candidateNotes.length;
    }
    const candidateAnalysisLimit = creatorCandidateAnalysisLimit(
      batchTarget,
      persisted + eligibleCandidateCount,
      Number.POSITIVE_INFINITY,
    );
    const candidateNotesToAnalyze = candidateNotes.slice(0, candidateAnalysisLimit);
    const alreadyInProject = await existingProjectCreatorIds(client, projectId, candidateNotes.map((note) => note.userId));
    const screeningRows: SearchScreeningInput[] = [];
    // Account-detail calls are the dominant wait in this pipeline. Prefetch a
    // two-item lookahead while the current candidate is being analyzed. The
    // actual semantic and hard-filter decisions remain ordered and deterministic.
    const hydrationPromises = new Map<string, ReturnType<typeof collector.hydrateCreatorProfile>>();
    let processedAll = true;
    let consumedCandidates = 0;
    await updateSearchTask(client, taskId, { status: "hard_filtering", collectedCount: stageCounts.notes_collected, persistedCount: persisted, duplicateCount: duplicates, stageCounts, progress: searchProgress(loopIteration, searchPolicy.maxRounds, persisted, batchTarget), stageMessageCode: "SEARCH_HARD_FILTERING" });

    const addScreening = (note: RedfoxNoteCandidate, disposition: SearchScreeningInput["disposition"], reasonCode: string, cooldownDays: number | null) => {
      const noteKey = redfoxNoteKey(note);
      screeningRows.push({ creatorPlatformId: note.userId, noteKey, noteId: note.noteId, disposition, reasonCode, nextEligibleAt: cooldownDays === null ? null : new Date(Date.now() + cooldownDays * 86_400_000).toISOString() });
    };

    for (let candidateIndex = 0; candidateIndex < candidateNotesToAnalyze.length; candidateIndex += 1) {
      const rawNote = candidateNotesToAnalyze[candidateIndex];
      const candidateControl = await currentExecutionControl();
      if (candidateControl === "cancelled") {
        await finishCancelled("analyzing");
        return;
      }
      if (candidateControl === "lease_lost") return;
      if (candidateControl === "timeout") {
        timedOut = true;
        processedAll = false;
        break;
      }
      stageCounts.candidates_started += 1;
      if (stageCounts.candidates_started === 1 || stageCounts.candidates_started % 5 === 0) {
        await updateSearchTask(client, taskId, {
          status: "analyzing",
          collectedCount: stageCounts.notes_collected,
          persistedCount: persisted,
          duplicateCount: duplicates,
          stageCounts,
          progress: searchProgress(loopIteration, searchPolicy.maxRounds, persisted, batchTarget),
          stageMessageCode: "SEARCH_ANALYZING",
        });
      }
      if (persisted >= batchTarget) {
        processedAll = false;
        break;
      }
      for (const lookahead of candidateNotesToAnalyze.slice(candidateIndex, candidateIndex + 2)) {
        if (!alreadyInProject.has(lookahead.userId) && !seenUsers.has(lookahead.userId) && !hydrationPromises.has(lookahead.userId)) {
          hydrationPromises.set(lookahead.userId, collector.hydrateCreatorProfile(lookahead, { includePostedNotes: false, includeNoteDetail: false }).catch((error) => ({
            profile: null,
            noteDetailError: null,
            accountDetailError: errorMessage(error),
            postedNotesError: null,
          })));
        }
      }
      consumedCandidates += 1;
      if (alreadyInProject.has(rawNote.userId)) {
        duplicates += 1;
        stageCounts.existing_duplicates += 1;
        rejections.push({ creatorId: rawNote.userId, nickname: rawNote.nickname, reason: "ALREADY_IN_PROJECT" });
        addScreening(rawNote, "project_existing", "ALREADY_IN_PROJECT", null);
        continue;
      }
      if (seenUsers.has(rawNote.userId)) {
        duplicates += 1;
        stageCounts.existing_duplicates += 1;
        rejections.push({ creatorId: rawNote.userId, nickname: rawNote.nickname, reason: "DUPLICATE_IN_SEARCH" });
        addScreening(rawNote, "filtered", "DUPLICATE_IN_SEARCH", 30);
        continue;
      }
      seenUsers.add(rawNote.userId);
      const hydration = await (hydrationPromises.get(rawNote.userId) ?? collector.hydrateCreatorProfile(rawNote, { includePostedNotes: false, includeNoteDetail: false }));
      let profile = hydration.profile;
      if (hydration.accountDetailError) {
        upstreamErrors += 1;
        stageCounts.profile_failures += 1;
        if (isProviderBudgetExhausted(hydration.accountDetailError)) {
          providerBudgetError = hydration.accountDetailError;
          processedAll = false;
        }
        rejections.push({ creatorId: rawNote.userId, nickname: rawNote.nickname, reason: "ACCOUNT_DETAIL_FAILED", detail: hydration.accountDetailError });
        if (!profile) {
          filtered += 1;
          addScreening(rawNote, "failed", "ACCOUNT_DETAIL_FAILED", 1);
          if (providerBudgetError) break;
          continue;
        }
      }
      if (!profile) {
        filtered += 1;
        stageCounts.profile_failures += 1;
        rejections.push({ creatorId: rawNote.userId, nickname: rawNote.nickname, reason: "PROFILE_NOT_RECOGNIZED", detail: hydration.noteDetailError ?? undefined });
        addScreening(rawNote, "failed", "PROFILE_NOT_RECOGNIZED", 1);
        continue;
      }
      let fields = profile.fields;
      const followersMatched = followersCond || followersMaxCond
        ? fields.followers !== null
          ? (!followersCond || satisfies(fields.followers, followersCond))
            && (!followersMaxCond || satisfies(fields.followers, followersMaxCond))
          : null
        : null;
      // Follower count is the non-relaxable proxy for a personal/small creator.
      // Reject missing and out-of-range values before any AI or work-list call.
      if (followersEnabled && followersMatched !== true) {
        stageCounts.follower_filtered += 1;
        if (fields.followers === null) stageCounts.follower_data_missing += 1;
        filtered += 1;
        const reason = fields.followers === null ? "FOLLOWERS_DATA_MISSING" : "FOLLOWERS_HARD_FILTER";
        rejections.push({ creatorId: rawNote.userId, nickname: fields.nickname, reason, detail: fields.followers === null ? undefined : String(fields.followers) });
        addScreening(rawNote, fields.followers === null ? "failed" : "filtered", reason, fields.followers === null ? 1 : 30);
        if (providerBudgetError) {
          processedAll = false;
          break;
        }
        continue;
      }
      const note = rawNote.text.trim() && (rawNote.noteType === "video" || rawNote.imageUrls.length > 0) ? rawNote : await collector.enrichNote(rawNote);
      semanticAttempts += 1;
      const noteAnalysis = await analyzeNote(semanticAnalysisQuery, note, provider, sharedPlan, profile);
      if (!noteAnalysis.analysisComplete) {
        analysisErrors += 1;
        stageCounts.analysis_errors += 1;
        rejections.push({ creatorId: note.userId, nickname: fields.nickname, reason: "SEMANTIC_ANALYSIS_FAILED" });
        addScreening(note, "failed", "SEMANTIC_ANALYSIS_FAILED", 1);
        continue;
      }
      if (!noteAnalysis.matched) {
        stageCounts.semantic_filtered += 1;
        stageCounts.quality_filtered += 1;
        rejections.push({ creatorId: note.userId, nickname: fields.nickname, reason: "SEMANTIC_NOT_MATCHED", detail: noteAnalysis.evidence.join(" | ").slice(0, 500) });
        addScreening(note, "filtered", "SEMANTIC_NOT_MATCHED", 30);
        continue;
      }
      if (!passesSemanticPreflight({
        semanticRequired,
        analysisComplete: noteAnalysis.analysisComplete,
        matched: noteAnalysis.matched,
        confidence: noteAnalysis.confidence,
        evidenceCount: noteAnalysis.evidence.length,
        qualityPolicy,
      })) {
        stageCounts.quality_filtered += 1;
        rejections.push({ creatorId: note.userId, nickname: fields.nickname, reason: "SEMANTIC_QUALITY_BELOW_MINIMUM", detail: String(noteAnalysis.confidence) });
        addScreening(note, "filtered", "SEMANTIC_QUALITY_BELOW_MINIMUM", 14);
        continue;
      }
      const recentLikesCond = rule.hard_filters?.recent_likes;
      const seedMeetsRecentLikes = recentLikesCond ? satisfiesRecentLikes([{ likes: note.likes, publishedAt: note.publishedAt }], recentLikesCond, rule.hard_filters?.recent_likes_window_days ?? 90) : true;
      if (needsActivityHistory || (recentLikesCond && !seedMeetsRecentLikes)) {
        const postedHydration = await collector.hydrateCreatorPostedNotes(note, profile);
        if (postedHydration.postedNotesError) {
          upstreamErrors += 1;
          stageCounts.profile_failures += 1;
          if (isProviderBudgetExhausted(postedHydration.postedNotesError)) {
            providerBudgetError = postedHydration.postedNotesError;
            processedAll = false;
          }
          rejections.push({ creatorId: note.userId, nickname: fields.nickname, reason: "POSTED_NOTES_FAILED", detail: postedHydration.postedNotesError });
        } else {
          profile = postedHydration.profile;
          fields = profile.fields;
        }
      }
      const recentLikesMatched = recentLikesCond
        ? satisfiesRecentLikes(fields.posts, recentLikesCond, rule.hard_filters?.recent_likes_window_days ?? 90)
        : null;
      if (recentLikesMatched === false) stageCounts.recent_likes_filtered += 1;
      const postMetrics = recentPostMetrics(fields.posts);
      const postsLast30dMatched = rule.hard_filters?.posts_last_30d
        ? satisfies(postMetrics.postsLast30d, rule.hard_filters.posts_last_30d)
        : null;
      const daysSinceLastPostMatched = rule.hard_filters?.days_since_last_post
        ? postMetrics.daysSinceLastPost !== null && satisfies(postMetrics.daysSinceLastPost, rule.hard_filters.days_since_last_post)
        : null;
      if (postsLast30dMatched === false) stageCounts.posts_last_30d_filtered += 1;
      if (daysSinceLastPostMatched === false) stageCounts.days_since_last_post_filtered += 1;
      const activity = computeActivityScore(fields.posts);
      const rankingScore = scoreCreatorCandidate({
        followersMatched,
        recentLikesMatched,
        postsLast30dMatched,
        daysSinceLastPostMatched,
        semanticMatched: noteAnalysis.analysisComplete ? noteAnalysis.matched : null,
        semanticConfidence: noteAnalysis.confidence,
        activityScore: activity.score,
        dataComplete: fields.dataCompleteness === "complete",
      });
      const qualityGate = passesCreatorQualityGate({
        semanticRequired,
        semanticMatched: noteAnalysis.analysisComplete ? noteAnalysis.matched : null,
        semanticConfidence: noteAnalysis.confidence,
        semanticEvidenceCount: noteAnalysis.evidence.length,
        rankingScore,
        qualityPolicy,
      });
      if (!qualityGate.passed) stageCounts.quality_filtered += 1;
      const previous = candidatePool.get(note.userId);
      if (!previous || rankingScore > previous.rankingScore) {
        candidatePool.set(note.userId, { note, profile, followersMatched, recentLikesMatched, postsLast30dMatched, daysSinceLastPostMatched, noteAnalysis, activity, rankingScore });
      }
      if (providerBudgetError) {
        processedAll = false;
        break;
      }
    }

    const eligibleBeforeAction = [...candidatePool.values()].filter((candidate) => passesCandidateGates({
      followersEnabled,
      recentLikesEnabled,
      postsLast30dEnabled,
      daysSinceLastPostEnabled,
      semanticRequired,
      followersMatched: candidate.followersMatched,
      recentLikesMatched: candidate.recentLikesMatched,
      postsLast30dMatched: candidate.postsLast30dMatched,
      daysSinceLastPostMatched: candidate.daysSinceLastPostMatched,
      semanticMatched: candidate.noteAnalysis.analysisComplete ? candidate.noteAnalysis.matched : null,
      semanticConfidence: candidate.noteAnalysis.confidence,
      semanticEvidenceCount: candidate.noteAnalysis.evidence.length,
      rankingScore: candidate.rankingScore,
      qualityPolicy,
      relaxedHardFilter: null,
      relaxedHardFilters: softenedHardFilters,
    }).passed);
    const newEligibleThisWave = Math.max(0, eligibleBeforeAction.length - eligibleCountBeforeWave);
    const nextConsecutiveNoGainRounds = newEligibleThisWave > 0 ? 0 : consecutiveNoGainRounds + 1;
    const loopAction = chooseSearchLoopAction(
      {
        iteration: loopIteration,
        softenedFilters: softenedHardFilters,
        consecutiveNoGainRounds: nextConsecutiveNoGainRounds,
        maxIterations: searchPolicy.maxRounds ?? Number.POSITIVE_INFINITY,
        keywordExpansionCount,
        maxRelaxedHardConditions: qualityPolicy.maximumRelaxedHardConditions,
      },
      {
        target: batchTarget,
        eligible: eligibleBeforeAction.length + persisted,
        candidatePool: candidatePool.size,
        newCreators: Math.max(0, candidatePool.size - candidatePoolSizeBeforeWave),
        newEligible: newEligibleThisWave,
        sourceExhausted: batch.sourceExhausted,
        providerBudgetError: Boolean(providerBudgetError),
        quality: { evaluated: semanticAttempts, failed: stageCounts.quality_filtered },
        filters: {
          followers: { evaluated: candidatePool.size, failed: stageCounts.follower_filtered },
          recent_likes: { evaluated: candidatePool.size, failed: stageCounts.recent_likes_filtered },
          posts_last_30d: { evaluated: candidatePool.size, failed: stageCounts.posts_last_30d_filtered },
          days_since_last_post: { evaluated: candidatePool.size, failed: stageCounts.days_since_last_post_filtered },
        },
      },
    );
    if (loopAction.type === "soften_filter") {
      softenedHardFilters.add(loopAction.filter);
      relaxedHardFilter = loopAction.filter;
    }
    if (loopAction.type === "expand_keywords") {
      keywordExpansionCount += 1;
      searchKeywords = expandedCreatorSearchKeywords(searchKeywords, query, keywordExpansionCount);
      sourceExhausted = false;
    }
    if (loopAction.type === "stop") loopStopReason = loopAction.reason;
    nextPageBudget = loopAction.type === "search_more"
      ? loopAction.pageBudget
      : loopAction.type === "expand_keywords"
        ? Math.max(2, wavePlan.pageBudget)
        : 1;
    consecutiveNoGainRounds = nextConsecutiveNoGainRounds;
    const eligibleCandidates = [...candidatePool.values()].filter((candidate) => passesCandidateGates({
      followersEnabled,
      recentLikesEnabled,
      postsLast30dEnabled,
      daysSinceLastPostEnabled,
      semanticRequired,
      followersMatched: candidate.followersMatched,
      recentLikesMatched: candidate.recentLikesMatched,
      postsLast30dMatched: candidate.postsLast30dMatched,
      daysSinceLastPostMatched: candidate.daysSinceLastPostMatched,
      semanticMatched: candidate.noteAnalysis.analysisComplete ? candidate.noteAnalysis.matched : null,
      semanticConfidence: candidate.noteAnalysis.confidence,
      semanticEvidenceCount: candidate.noteAnalysis.evidence.length,
      rankingScore: candidate.rankingScore,
      qualityPolicy,
      relaxedHardFilter: null,
      relaxedHardFilters: softenedHardFilters,
    }).passed);
    // Persist every currently quality-approved candidate in small waves. This
    // keeps the UI and database truthful during long searches and makes a
    // cancellation/restart resumable without losing accepted creators.
    const selectedThisWave = selectTopCreatorCandidates(eligibleCandidates, batchTarget - persisted);
    if (selectedThisWave.length) {
      const saved = await persistRankedCandidates({
        client,
        userId: job.user_id,
        projectId,
        taskId,
        provider,
        searchKeywords,
        softenedHardFilters,
        candidates: selectedThisWave,
      });
      persisted += saved.persisted;
      screeningRows.push(...saved.screenings);
      for (const candidate of selectedThisWave) candidatePool.delete(candidate.note.userId);
    }
    eligibleCandidateCount = [...candidatePool.values()].filter((candidate) => passesCandidateGates({
      followersEnabled,
      recentLikesEnabled,
      postsLast30dEnabled,
      daysSinceLastPostEnabled,
      semanticRequired,
      followersMatched: candidate.followersMatched,
      recentLikesMatched: candidate.recentLikesMatched,
      postsLast30dMatched: candidate.postsLast30dMatched,
      daysSinceLastPostMatched: candidate.daysSinceLastPostMatched,
      semanticMatched: candidate.noteAnalysis.analysisComplete ? candidate.noteAnalysis.matched : null,
      semanticConfidence: candidate.noteAnalysis.confidence,
      semanticEvidenceCount: candidate.noteAnalysis.evidence.length,
      rankingScore: candidate.rankingScore,
      qualityPolicy,
      relaxedHardFilter: null,
      relaxedHardFilters: softenedHardFilters,
    }).passed).length;
    const remainingPendingNotes = pendingBatch?.notes.slice(consumedCandidates) ?? [];
    const pendingAfterWave: PendingSearchBatch | null = persisted >= batchTarget
      ? null
      : remainingPendingNotes.length
      ? { notes: remainingPendingNotes, cursor: pendingBatch?.cursor ?? batch.cursor, sourceExhausted: pendingBatch?.sourceExhausted ?? batch.sourceExhausted }
      : null;
    pendingBatch = pendingAfterWave;
    await recordSearchScreenings(client, { sessionId: session.id, taskId, userId: job.user_id, projectId, rows: screeningRows });
    if (!pendingAfterWave && processedAll && !providerBudgetError) {
      cursor = batch.cursor;
      sourceExhausted = loopAction.type === "expand_keywords" ? false : batch.sourceExhausted;
      await saveSearchSessionProgress(client, session.id, cursor, sourceExhausted, searchKeywords, null);
    } else {
      cursor = cursorBeforeWave;
      sourceExhausted = false;
      await saveSearchSessionProgress(client, session.id, cursor, false, searchKeywords, pendingAfterWave);
    }
    const provisionalCount = Math.min(batchTarget, persisted + eligibleCandidateCount);
    stageCounts.persisted = provisionalCount;
    stageCounts.loop_iteration = loopIteration;
    stageCounts.eligible_candidates = eligibleCandidateCount;
    stageCounts.softened_filters = softenedHardFilters.size;
    await updateSearchTask(client, taskId, { collectedCount: stageCounts.notes_collected, persistedCount: provisionalCount, duplicateCount: duplicates, stageCounts, loopState: { version: "creator-search-loop-v3", iteration: loopIteration, action: loopAction.type, reason: "reason" in loopAction ? loopAction.reason : null, softened_filters: [...softenedHardFilters], candidate_pool: candidatePool.size, eligible_candidates: eligibleCandidateCount, quality_policy: qualityPolicy, keyword_expansion_count: keywordExpansionCount, consecutive_no_quality_gain_rounds: consecutiveNoGainRounds, last_observation: { new_creators: Math.max(0, candidatePool.size - candidatePoolSizeBeforeWave), new_eligible: newEligibleThisWave, analyzed_candidates: candidateNotesToAnalyze.length, source_exhausted: sourceExhausted, provider_budget_error: Boolean(providerBudgetError), quality_failures: stageCounts.quality_filtered, filter_failures: { followers: stageCounts.follower_filtered, recent_likes: stageCounts.recent_likes_filtered, posts_last_30d: stageCounts.posts_last_30d_filtered, days_since_last_post: stageCounts.days_since_last_post_filtered } } }, progress: searchProgress(loopIteration, searchPolicy.maxRounds, provisionalCount, batchTarget), stageMessageCode: provisionalCount > 0 ? "SEARCH_PERSISTING" : "SEARCH_HARD_FILTERING" });
  }
  const gateForCandidate = (candidate: RankedCandidate): { passed: boolean; reason: string | null } => passesCandidateGates({
    followersEnabled,
    recentLikesEnabled,
    postsLast30dEnabled,
    daysSinceLastPostEnabled,
    semanticRequired,
    followersMatched: candidate.followersMatched,
    recentLikesMatched: candidate.recentLikesMatched,
    postsLast30dMatched: candidate.postsLast30dMatched,
    daysSinceLastPostMatched: candidate.daysSinceLastPostMatched,
    semanticMatched: candidate.noteAnalysis.analysisComplete ? candidate.noteAnalysis.matched : null,
    semanticConfidence: candidate.noteAnalysis.confidence,
    semanticEvidenceCount: candidate.noteAnalysis.evidence.length,
    rankingScore: candidate.rankingScore,
    qualityPolicy,
    relaxedHardFilter: null,
    relaxedHardFilters: softenedHardFilters,
  });
  const finalEligible = [...candidatePool.values()].filter((candidate) => gateForCandidate(candidate).passed);
  // ReAct may soften at most one dominant data condition during collection.
  // Finalization never lowers the AI quality floor or relaxes extra conditions
  // merely to fill twenty slots.
  const finalSelected = selectTopCreatorCandidates(finalEligible, batchTarget - persisted);
  const finalSelectedIds = new Set(finalSelected.map((candidate) => candidate.note.userId));
  const finalScreenings: SearchScreeningInput[] = [];
  for (const candidate of candidatePool.values()) {
    const gate = gateForCandidate(candidate);
    if (!gate.passed) {
      filtered += 1;
      rejections.push({ creatorId: candidate.note.userId, nickname: candidate.profile.fields.nickname, reason: gate.reason ?? "HARD_FILTER", detail: String(candidate.rankingScore) });
      finalScreenings.push({ creatorPlatformId: candidate.note.userId, noteKey: redfoxNoteKey(candidate.note), noteId: candidate.note.noteId, disposition: "filtered", reasonCode: gate.reason ?? "HARD_FILTER", nextEligibleAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    } else if (!finalSelectedIds.has(candidate.note.userId)) {
      filtered += 1;
      rejections.push({ creatorId: candidate.note.userId, nickname: candidate.profile.fields.nickname, reason: "RANKED_BELOW_CUTOFF", detail: String(candidate.rankingScore) });
      finalScreenings.push({ creatorPlatformId: candidate.note.userId, noteKey: redfoxNoteKey(candidate.note), noteId: candidate.note.noteId, disposition: "filtered", reasonCode: "RANKED_BELOW_CUTOFF", nextEligibleAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    }
  }
  for (const ranked of finalSelected) {
    const { note, profile, followersMatched, recentLikesMatched, postsLast30dMatched, daysSinceLastPostMatched, noteAnalysis, activity, rankingScore } = ranked;
    const fields = profile.fields;
    const stableProfileUrl = canonicalProfileUrl(profile.ref.profileUrl, profile.ref.platformCreatorId);
    const evidence = noteAnalysis.evidence;
    const scoreEvidence = [
      `综合评分 ${rankingScore}`,
      softenedHardFilters.size ? `已软化条件：${[...softenedHardFilters].join("、")}` : "",
      followersMatched === false ? "粉丝条件未达，已由评分降权" : "",
      recentLikesMatched === false ? "近期点赞条件未达，已由评分降权" : "",
      postsLast30dMatched === false ? "近30天发帖条件未达，已由评分降权" : "",
      daysSinceLastPostMatched === false ? "最近发帖时间条件未达，已由评分降权" : "",
      ...evidence,
    ].filter(Boolean);
    const semantic = {
      conditions: [{ condition_id: "redfox_note_semantic_match", verdict: noteAnalysis.analysisComplete ? (noteAnalysis.matched ? "matched" : "not_matched") : "review", confidence: noteAnalysis.confidence, evidence_ids: evidence.map((_, i) => `redfox-${i}`), reason: scoreEvidence.join(" | ") }],
      activity: { score: activity.score, posts: fields.posts.length, medianInteraction: activity.medianInteraction },
      matchScore: rankingScore,
      evidenceSummary: scoreEvidence.join(" | ") || "综合评分保留，等待人工复核。",
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      matcher: noteAnalysis.analysisComplete ? "llm_weighted_ranking" : "weighted_fallback",
      imageEvidence: noteAnalysis.imageEvidence,
      llmStatus: noteAnalysis.analysisComplete ? "scored" : noteAnalysis.run?.status ?? "error",
      source: provider,
      searchKeywords,
    };
    const { data: creator, error: creatorError } = await client.from("creators").upsert({ platform: "xiaohongshu", platform_creator_id: profile.ref.platformCreatorId, nickname: fields.nickname ?? "未命名达人", handle: fields.handle, profile_url: stableProfileUrl, avatar_url: fields.avatarUrl, latest_snapshot: { ...fields, source: provider, matched_note_id: note.noteId } as unknown as Record<string, unknown>, latest_captured_at: fields.capturedAt }, { onConflict: "platform,platform_creator_id" }).select("id").single();
    if (creatorError || !creator) throw new Error(`upsert creator: ${creatorError?.message ?? "no row"}`);
    const { data: linkRow, error: linkError } = await client.from("project_creators").upsert({ user_id: job.user_id, project_id: projectId, creator_id: creator.id, search_task_id: taskId, decision_status: "pending", contact_status: "not_contacted", followers: fields.followers, activity_score: semantic.activity.score, match_score: semantic.matchScore, data_completeness: fields.dataCompleteness, field_warnings: fields.warnings as unknown as unknown[], evidence_summary: semantic.evidenceSummary, analysis_json: { semantic: semantic.conditions, activity: semantic.activity, posts: fields.posts, imageUrls: fields.imageUrls, llm_status: semantic.llmStatus, image_evidence: semantic.imageEvidence, matcher: semantic.matcher, schema_version: semantic.schemaVersion, source: provider, note_id: note.noteId, note_text: note.text } as unknown as Record<string, unknown>, captured_at: fields.capturedAt }, { onConflict: "project_id,creator_id" }).select("id").single();
    if (linkError || !linkRow) throw new Error(`upsert project_creator: ${linkError?.message ?? "no row"}`);
    const { error: evidenceError } = await client.from("creator_evidence").insert({ user_id: job.user_id, project_creator_id: linkRow.id, evidence_type: "ai_analysis", source_url: note.noteId ? `https://www.xiaohongshu.com/explore/${note.noteId}` : stableProfileUrl, excerpt: semantic.evidenceSummary.slice(0, 2000), confidence: noteAnalysis.confidence, captured_at: fields.capturedAt });
    if (evidenceError) throw new Error(`insert creator_evidence: ${evidenceError.message}`);
    persisted += 1;
    finalScreenings.push({ creatorPlatformId: note.userId, noteKey: redfoxNoteKey(note), noteId: note.noteId, disposition: "accepted", reasonCode: "ACCEPTED", nextEligibleAt: null });
  }
  stageCounts.persisted = persisted;
  if (finalScreenings.length) await recordSearchScreenings(client, { sessionId: session.id, taskId, userId: job.user_id, projectId, rows: finalScreenings });
  const partial = persisted < batchTarget;
  const metrics = collector.getMetrics();
  const hasUpstreamErrors = analysisErrors + upstreamErrors > 0;
  const analysisFailed = persisted === 0 && semanticAttempts > 0 && analysisErrors === semanticAttempts;
  if (timedOut) {
    const elapsedMinutes = Math.max(1, Math.round((Date.now() - executionStartedAt) / 60_000));
    const reachedTarget = persisted >= batchTarget;
    const message = reachedTarget
      ? `本次真实检索在 ${elapsedMinutes} 分钟运行上限前已达到 ${persisted}/${batchTarget} 人，结果已全部保存。`
      : `本次真实检索已达到 ${elapsedMinutes} 分钟运行上限，已安全停止并保留进度；当前新增 ${persisted}/${batchTarget} 人，可再次检索从游标位置继续。`;
    await finalizeSearchExecution(
      () => updateSearchTask(client, taskId, { status: reachedTarget ? "completed" : "partial", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, stageCounts, canContinue: !reachedTarget, partialReason: reachedTarget ? null : "execution_timeout", errorCode: null, errorMessage: message }),
      () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: reachedTarget ? "completed" : "partial", stage: "analyzing", terminal: true, progress: 100, messageCode: reachedTarget ? "SEARCH_COMPLETED" : "SEARCH_TIME_LIMIT_REACHED", errorMessage: message, retryable: false, result: { source: provider, runtimeDiagnostics, qualityPolicy, relaxedHardFilter, softenedHardFilters: [...softenedHardFilters], loopIteration, loopStopReason, searchKeywords, keywordFailures, sessionId: session.id, cursor, sourceExhausted: false, batchTarget, canContinue: !reachedTarget, searchPolicy, collected: stageCounts.notes_collected, persisted, duplicates, filtered, analysisErrors, upstreamErrors, stageCounts, rejections, ...metrics } }),
    );
    return;
  }
  if (providerBudgetError && isProviderCredentialError(providerBudgetError)) {
    const message = creatorSearchBudgetStopMessage(providerBudgetError, persisted, batchTarget);
    await finalizeSearchExecution(
      () => updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, stageCounts, canContinue: true, errorCode: "REDFOX_CREDENTIAL_INVALID", errorMessage: message }),
      () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "REDFOX_CREDENTIAL_INVALID", errorCode: "REDFOX_CREDENTIAL_INVALID", errorMessage: message, retryable: false, result: { source: provider, runtimeDiagnostics, searchKeywords, keywordFailures, sessionId: session.id, cursor, collected: stageCounts.notes_collected, persisted, duplicates, stageCounts, ...metrics } }),
    );
    return;
  }
  if (analysisFailed) {
    const message = "达人内容分析未完成：模型请求失败或未配置，未将结果误判为不匹配。请检查 DeepSeek 配置后重试。";
    await finalizeSearchExecution(
      () => updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, stageCounts, canContinue: !sourceExhausted, errorCode: "LLM_ANALYSIS_FAILED", errorMessage: message }),
      () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "analyzing", terminal: true, progress: 100, messageCode: "LLM_ANALYSIS_FAILED", errorCode: "LLM_ANALYSIS_FAILED", retryable: true, retryAfterSeconds: 30, result: { source: provider, runtimeDiagnostics, relaxedHardFilter, searchKeywords, keywordFailures, sessionId: session.id, cursor, collected: stageCounts.notes_collected, persisted, duplicates, filtered, analysisErrors, upstreamErrors, stageCounts, rejections, ...metrics } }),
    );
    return;
  }
  const canContinue = !sourceExhausted;
  const partialReason = partial ? (providerBudgetError ? "platform_rate_limited" : sourceExhausted ? "source_exhausted" : loopStopReason ? "loop_limit" : hasUpstreamErrors ? "upstream_error" : "source_exhausted") : null;
  const qualityDominant = stageCounts.quality_filtered > 0
    && stageCounts.quality_filtered >= stageCounts.follower_filtered
    && stageCounts.quality_filtered >= stageCounts.profile_failures;
  const finalMessage = providerBudgetError
    ? creatorSearchBudgetStopMessage(providerBudgetError, persisted, batchTarget)
    : partial && qualityDominant
      ? creatorSearchQualityPartialMessage(stageCounts, batchTarget)
      : partial && (hasUpstreamErrors || sourceExhausted)
        ? creatorSearchPartialMessage(stageCounts, batchTarget)
        : partial && loopStopReason
          ? `${loopStopReason}；当前新增 ${persisted}/${batchTarget} 人，已保留已找到的候选供人工复核。`
          : null;
  const { error: versionError } = await client.from("search_tasks").update({ model_version: "redfox-skill-agent-v2", prompt_version: "creator-agent.v3", rule_schema_version: "search-rule.v1" }).eq("id", taskId);
  if (versionError) runtimeDiagnostics.versionUpdateError = versionError.message;
  await finalizeSearchExecution(
    () => updateSearchTask(client, taskId, { status: partial ? "partial" : "completed", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, stageCounts, loopState: { version: "creator-search-loop-v3", iteration: loopIteration, action: partial ? "stop" : "finalize", reason: loopStopReason, softened_filters: [...softenedHardFilters], candidate_pool: candidatePool.size, eligible_candidates: finalEligible.length, quality_policy: qualityPolicy, keyword_expansion_count: keywordExpansionCount, consecutive_no_quality_gain_rounds: consecutiveNoGainRounds, last_observation: { source_exhausted: sourceExhausted, provider_budget_error: Boolean(providerBudgetError), persisted, quality_failures: stageCounts.quality_filtered } }, canContinue, partialReason, errorCode: null, errorMessage: finalMessage }),
    () => finishJob(pool, { jobId: job.id, userId: job.user_id, status: partial ? "partial" : "completed", stage: "persisting", terminal: true, progress: 100, messageCode: partial ? "SEARCH_PARTIAL" : "SEARCH_COMPLETED", result: { source: provider, runtimeDiagnostics, qualityPolicy, relaxedHardFilter, softenedHardFilters: [...softenedHardFilters], loopIteration, loopStopReason, hardFilterFailureCounts: { followers: stageCounts.follower_filtered, recentLikes: stageCounts.recent_likes_filtered, postsLast30d: stageCounts.posts_last_30d_filtered, daysSinceLastPost: stageCounts.days_since_last_post_filtered }, searchKeywords, keywordFailures, sessionId: session.id, cursor, sourceExhausted, batchTarget, canContinue, searchPolicy, collected: stageCounts.notes_collected, persisted, duplicates, filtered, analysisErrors, upstreamErrors, stageCounts, rejections, ...metrics } }),
  );
}
