import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { run as runSkillsAgent } from "../../agent/run-agent.js";
import { plan } from "../../agent/plan-agent.js";
import type { AgentPlan } from "../../agent/skills/types.js";
import { SEMANTIC_SCHEMA_VERSION, computeActivityScore } from "./xhs-semantic-matcher.js";
import { createRnoteXhsClient, type RnoteNoteCandidate, type RnoteCreatorProfile } from "./rnote-xhs-client.js";
import { finishJob, updateSearchTask, type SearchJob, type SearchJobPayload, type WorkerEnv } from "./xhs-db.js";

interface RuleCondition { field: string; operator: "lt" | "lte" | "gt" | "gte" | "eq"; value: number | string | boolean; }
interface ParsedRule { hard_filters?: { followers?: RuleCondition; posts_last_30d?: RuleCondition; days_since_last_post?: RuleCondition }; }

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function canonicalProfileUrl(profileUrl: string, creatorId: string): string {
  const match = profileUrl.match(/\/user\/profile\/([^/?#]+)/i);
  return `https://www.xiaohongshu.com/user/profile/${match?.[1] ?? creatorId}`;
}
function satisfies(value: number, condition: RuleCondition): boolean {
  const target = Number(condition.value);
  switch (condition.operator) { case "lt": return value < target; case "lte": return value <= target; case "gt": return value > target; case "gte": return value >= target; case "eq": return value === target; default: return true; }
}
function candidateForNote(note: RnoteNoteCandidate, query: string, source: string) {
  return { id: note.noteId ?? `${note.userId}:${note.title}`, nickname: note.nickname ?? "", handle: note.handle ?? undefined, profileUrl: note.profileUrl, bio: undefined, followers: undefined, posts: [{ title: note.title, text: note.text, interaction: note.interaction, imageUrls: note.imageUrls }], imageUrls: note.imageUrls, source, query };
}
function keywordFromIntent(value: unknown, fallback: string): string {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const values: string[] = [];
  for (const key of ["searchKeywords", "keywords", "semanticTerms", "semantic_conditions"]) {
    const item = record[key];
    if (typeof item === "string" && item.trim()) values.push(item.trim());
    if (Array.isArray(item)) for (const entry of item) {
      if (typeof entry === "string" && entry.trim()) values.push(entry.trim());
      if (entry && typeof entry === "object") {
        const terms = (entry as Record<string, unknown>).terms;
        if (Array.isArray(terms)) values.push(...terms.filter((term): term is string => typeof term === "string" && Boolean(term.trim())));
      }
    }
  }
  const useful = values.map((value) => value.replace(/^\s*(?:\u4f60\u662f|\u6211\u662f|\u4f5c\u4e3a|\u8bf7|\u5e2e\u6211|\u9700\u8981|\u5bfb\u627e|\u627e)\s*/, "").trim()).filter((value) => value.length >= 2).filter((value) => !/^(?:\u9ad8\u7ea7)?\u5a92\u4ecb\u4e13\u5458|\u5a92\u4ecb\u4e13\u5458|\u8fbe\u4eba|\u535a\u4e3b|\u7d20\u4eba$/.test(value)).filter((value) => !/^(?:\u9700\u8981|\u8bf7|\u5e2e\u6211|\u627e|\u7b5b\u9009|\u6709\u53d1\u8fc7\u7c7b\u4f3c\u7684)/.test(value));
  const cleanedFallback = fallback.replace(/^\s*(?:\u4f60\u662f|\u6211\u662f|\u4f5c\u4e3a|\u8bf7|\u5e2e\u6211|\u9700\u8981|\u5bfb\u627e|\u627e)\s*/, "").trim();
  return Array.from(new Set(useful)).slice(0, 6).join(" ") || cleanedFallback || fallback;
}

async function analyzeNote(query: string, note: RnoteNoteCandidate, source: string, sharedPlan?: AgentPlan) {
  const run = await runSkillsAgent(query, [candidateForNote(note, query, source)], sharedPlan);
  const candidate = run.candidates[0] as { semanticMatch?: { matched?: boolean; confidence?: number; evidence?: string[]; reasons?: string[] }; imageEvidence?: unknown; matchScore?: number } | undefined;
  const match = candidate?.semanticMatch ?? {};
  const evidence = [...(match.evidence ?? []), ...(match.reasons ?? [])];
  return { run, candidate, matched: run.status === "scored" && match.matched === true, confidence: Math.max(0, Math.min(1, Number(match.confidence ?? 0))), evidence, imageEvidence: candidate?.imageEvidence, matchScore: Number(candidate?.matchScore ?? 0) };
}

export async function runRnoteCreatorSearchJob(env: WorkerEnv, client: SupabaseClient, pool: pg.Pool, job: SearchJob): Promise<void> {
  const payload = job.payload as unknown as SearchJobPayload;
  const { search_task_id: taskId, project_id: projectId, keyword, query_text: queryText, target_count: targetCount, confirmed_rule } = payload;
  const rule = (confirmed_rule ?? {}) as ParsedRule;
  const provider = env.XHS_DATA_PROVIDER === "dataflow" ? "dataflow" : env.XHS_DATA_PROVIDER === "redfox" ? "redfox" : "rnote";
  const providerLabel = provider === "dataflow" ? "DataFlow" : provider === "redfox" ? "RedFoxHub" : "Rnote";
  const followersCond = rule.hard_filters?.followers;
  if (job.cancel_requested) {
    await updateSearchTask(client, taskId, { status: "cancelled", terminal: true, progress: 100, errorCode: null, errorMessage: null });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "cancelled", stage: "queued", terminal: true, progress: 100, messageCode: "SEARCH_CANCELLED" });
    return;
  }
  const configuredApiKey = provider === "dataflow" ? env.DATAFLOW_API_KEY : provider === "redfox" ? env.REDFOX_API_KEY : env.RNOTE_API_KEY;
  if (!configuredApiKey || configuredApiKey.startsWith("REPLACE_WITH_")) {
    const message = `${providerLabel} data source is not configured. Set ${provider === "dataflow" ? "DATAFLOW_API_KEY" : provider === "redfox" ? "REDFOX_API_KEY" : "RNOTE_API_KEY"} in .env.local.`;
    await updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", errorMessage: message });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", errorCode: "XHS_DATA_PROVIDER_NOT_CONFIGURED", retryable: false });
    return;
  }

  const collector = createRnoteXhsClient(env);
  const query = queryText?.trim() || keyword;
  await updateSearchTask(client, taskId, { status: "collecting", progress: 5, stageMessageCode: "SEARCH_ANALYZING_INTENT" });
  let searchKeyword = keyword;
  try {
    const intentPlan: AgentPlan = { planner: "creator-search-intent-v1", steps: [{ id: "intent", capabilityType: "skill", capabilityId: "creator_intent_structuring", purpose: "提取检索关键词" }] };
    const intentRun = await runSkillsAgent(query, [], intentPlan);
    searchKeyword = keywordFromIntent(intentRun.structuredQuery, keyword);
  } catch {
    // The server parser keyword remains a safe fallback when the intent model is unavailable.
  }

  let notes: RnoteNoteCandidate[] = [];
  try {
    const result = await collector.searchNoteCandidates(searchKeyword, targetCount);
    notes = result.notes;
  } catch (error) {
    const message = errorMessage(error);
    await updateSearchTask(client, taskId, { status: "failed", terminal: true, progress: 100, errorCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", errorMessage: message });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "collecting", terminal: true, progress: 100, messageCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", errorCode: "XHS_DATA_PROVIDER_REQUEST_FAILED", retryable: true, retryAfterSeconds: 60, result: { source: provider, searchKeyword, ...collector.getMetrics() } });
    return;
  }
  await updateSearchTask(client, taskId, { collectedCount: notes.length, progress: 25, stageMessageCode: "SEARCH_ANALYZING_CONTENT" });
  if (!notes.length) {
    await updateSearchTask(client, taskId, { status: "partial", terminal: true, progress: 100, partialReason: "source_exhausted", errorMessage: `${providerLabel} returned no recognizable Xiaohongshu notes.` });
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "partial", stage: "collecting", terminal: true, progress: 100, messageCode: "SEARCH_EMPTY", result: { source: provider, searchKeyword, collected: 0, ...collector.getMetrics() } });
    return;
  }

  const planInput = notes.find((item) => item.imageUrls.length > 0) ?? notes[0];
  const planned = await plan(query, [candidateForNote(planInput, query, provider)]);
  const sharedPlan: AgentPlan = { ...planned, steps: planned.steps.filter((step) => ["load_candidates", "dedupe_candidates", "creator_image_understanding", "creator_semantic_matching", "rank_candidates"].includes(step.capabilityId)) };
  const needsActivity = Boolean(rule.hard_filters?.posts_last_30d || rule.hard_filters?.days_since_last_post) || /\u6d3b\u8dc3|\u66f4\u65b0|\u7b14\u8bb0|\u53d1\u5e03|\u70b9\u8d5e|\u4e92\u52a8/.test(query);
  const seenCandidateUsers = new Set<string>();
  const candidateNotes = notes.filter((note) => {
    if (seenCandidateUsers.has(note.userId)) return false;
    seenCandidateUsers.add(note.userId);
    return true;
  });
  let persisted = 0;
  let duplicates = 0;
  let filtered = 0;
  const seenUsers = new Set<string>();
  for (let index = 0; index < candidateNotes.length && persisted < targetCount; index += 1) {
    const rawNote = candidateNotes[index];
    const note = rawNote.text.trim() && (rawNote.noteType === "video" || rawNote.imageUrls.length > 0)
      ? rawNote
      : await collector.enrichNote(rawNote);
    const noteAnalysis = await analyzeNote(query, note, provider, sharedPlan);
    if (!noteAnalysis.matched) { filtered += 1; continue; }
    if (seenUsers.has(note.userId)) { duplicates += 1; continue; }
    seenUsers.add(note.userId);
    const profile = await collector.hydrateCreatorProfile(note, { includePostedNotes: needsActivity });
    if (!profile) { filtered += 1; continue; }
    const fields = profile.fields;
    if (followersCond && (fields.followers === null || !satisfies(fields.followers, followersCond))) { filtered += 1; continue; }
    const activity = computeActivityScore(fields.posts);
    const stableProfileUrl = canonicalProfileUrl(profile.ref.profileUrl, profile.ref.platformCreatorId);
    const existingCreator = await client.from("creators").select("id").eq("platform", "xiaohongshu").eq("platform_creator_id", profile.ref.platformCreatorId).maybeSingle();
    if (existingCreator.data) {
      const existingLink = await client.from("project_creators").select("id").eq("project_id", projectId).eq("creator_id", existingCreator.data.id).maybeSingle();
      if (existingLink.data) { duplicates += 1; continue; }
    }
    const evidence = noteAnalysis.evidence;
    const semantic = {
      conditions: [{ condition_id: "rnote_note_semantic_match", verdict: "matched", confidence: noteAnalysis.confidence, evidence_ids: evidence.map((_, i) => `rnote-${i}`), reason: evidence.join(" | ") || "No semantic evidence returned." }],
      activity: { score: activity.score, posts: fields.posts.length, medianInteraction: activity.medianInteraction },
      matchScore: noteAnalysis.matchScore,
      evidenceSummary: evidence.join(" | ") || "No evidence returned by the provider.",
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      matcher: noteAnalysis.run.status === "scored" ? "llm" : "pending_llm",
      imageEvidence: noteAnalysis.imageEvidence,
      llmStatus: noteAnalysis.run.status,
      source: provider,
      searchKeyword,
    };
    const { data: creator, error: creatorError } = await client.from("creators").upsert({ platform: "xiaohongshu", platform_creator_id: profile.ref.platformCreatorId, nickname: fields.nickname ?? "閺堫亞鐓℃潏鍙ユ眽", handle: fields.handle, profile_url: stableProfileUrl, avatar_url: fields.avatarUrl, latest_snapshot: { ...fields, source: provider, matched_note_id: note.noteId } as unknown as Record<string, unknown>, latest_captured_at: fields.capturedAt }, { onConflict: "platform,platform_creator_id" }).select("id").single();
    if (creatorError || !creator) throw new Error(`upsert creator: ${creatorError?.message ?? "no row"}`);
    const { data: linkRow, error: linkError } = await client.from("project_creators").upsert({ user_id: job.user_id, project_id: projectId, creator_id: creator.id, search_task_id: taskId, decision_status: "pending", contact_status: "not_contacted", followers: fields.followers, activity_score: semantic.activity.score, match_score: semantic.matchScore, data_completeness: fields.dataCompleteness, field_warnings: fields.warnings as unknown as unknown[], evidence_summary: semantic.evidenceSummary, analysis_json: { semantic: semantic.conditions, activity: semantic.activity, posts: fields.posts, imageUrls: fields.imageUrls, llm_status: semantic.llmStatus, image_evidence: semantic.imageEvidence, matcher: semantic.matcher, schema_version: semantic.schemaVersion, source: provider, note_id: note.noteId, note_text: note.text } as unknown as Record<string, unknown>, captured_at: fields.capturedAt }, { onConflict: "project_id,creator_id" }).select("id").single();
    if (linkError || !linkRow) throw new Error(`upsert project_creator: ${linkError?.message ?? "no row"}`);
    const { error: evidenceError } = await client.from("creator_evidence").insert({ user_id: job.user_id, project_creator_id: linkRow.id, evidence_type: "ai_analysis", source_url: note.noteId ? `https://www.xiaohongshu.com/explore/${note.noteId}` : stableProfileUrl, excerpt: semantic.evidenceSummary.slice(0, 2000), confidence: noteAnalysis.confidence, captured_at: fields.capturedAt });
    if (evidenceError) throw new Error(`insert creator_evidence: ${evidenceError.message}`);
    persisted += 1;
    await updateSearchTask(client, taskId, { persistedCount: persisted, duplicateCount: duplicates, progress: 25 + Math.round((persisted / Math.max(targetCount, 1)) * 70), stageMessageCode: "SEARCH_PERSISTING" });
  }
  const partial = persisted < targetCount;
  const metrics = collector.getMetrics();
  await updateSearchTask(client, taskId, { status: partial ? "partial" : "completed", terminal: true, progress: 100, persistedCount: persisted, duplicateCount: duplicates, partialReason: partial ? "source_exhausted" : null, errorCode: null, errorMessage: null });
  const { error: versionError } = await client.from("search_tasks").update({ model_version: "rnote-skill-agent-v1", prompt_version: "creator-agent.v2", rule_schema_version: "search-rule.v1" }).eq("id", taskId);
  if (versionError) throw new Error(`update search_tasks versions: ${versionError.message}`);
  await finishJob(pool, { jobId: job.id, userId: job.user_id, status: partial ? "partial" : "completed", stage: "persisting", terminal: true, progress: 100, messageCode: partial ? "SEARCH_PARTIAL" : "SEARCH_COMPLETED", result: { source: provider, searchKeyword, collected: notes.length, persisted, duplicates, filtered, ...metrics } });
}
