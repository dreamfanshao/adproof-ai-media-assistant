import assert from "node:assert/strict";
import test from "node:test";
import { buildCreatorSearchKeywords } from "../src/creator-search-keywords.js";
import { normalizeCreatorIntent } from "../../agent/run-agent.js";
import { CREATOR_SEARCH_STRATEGY_VERSION, creatorSearchKey, isSearchSourceExhausted, projectSearchHistoryFromRows, saveSearchSessionProgress } from "../src/creator-search-session.js";
import { normalizeProfile, redfoxSearchRequestParams, RedfoxXhsClient, type RedfoxNoteCandidate } from "../src/redfox-xhs-client.js";
import { chooseSearchLoopAction, expandedCreatorSearchKeywords } from "../src/creator-search-loop.js";
import { creatorCandidateAnalysisLimit, creatorQualityPolicyFromIntent, creatorSearchBudgetStopMessage, creatorSearchLoopPolicy, creatorSearchPartialMessage, creatorSearchWavePlan, creatorSemanticAnalysisQuery, finalizeSearchExecution, isProviderBudgetExhausted, isProviderCredentialError, passesCandidateGates, passesCreatorQualityGate, passesSemanticPreflight, recentPostMetrics, satisfiesRecentLikes, scoreCreatorCandidate, searchMaxDurationMs, selectDominantHardFilter, selectRepresentativeNotes, selectTopCreatorCandidates, shouldContinueCreatorSearch } from "../src/redfox-search-executor.js";

test("search loop never softens followers and may soften the highest-impact secondary filter", () => {
  const action = chooseSearchLoopAction(
    { iteration: 1, softenedFilters: new Set(), consecutiveNoGainRounds: 0, maxIterations: 12 },
    {
      target: 20,
      eligible: 4,
      candidatePool: 24,
      newCreators: 24,
      sourceExhausted: false,
      filters: {
        followers: { evaluated: 24, failed: 18 },
        recent_likes: { evaluated: 24, failed: 16 },
      },
    },
  );
  assert.deepEqual(action.type, "soften_filter");
  assert.equal(action.filter, "recent_likes");
});

test("search loop never softens a second hard filter", () => {
  const softened = new Set(["recent_likes"] as const);
  const action = chooseSearchLoopAction(
    { iteration: 2, softenedFilters: softened, consecutiveNoGainRounds: 0, maxIterations: 12 },
    {
      target: 20,
      eligible: 10,
      candidatePool: 30,
      newCreators: 6,
      sourceExhausted: false,
      filters: { recent_likes: { evaluated: 30, failed: 15 } },
    },
  );
  assert.notEqual(action.type, "soften_filter");
});

test("candidate gates ignore any legacy attempt to relax followers", () => {
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: false,
    semanticRequired: false,
    followersMatched: false,
    recentLikesMatched: null,
    semanticMatched: null,
    relaxedHardFilter: "followers" as never,
  }), { passed: false, reason: "FOLLOWERS_HARD_FILTER" });
});

test("search loop does not soften unavailable follower data", () => {
  const action = chooseSearchLoopAction(
    { iteration: 3, softenedFilters: new Set(), consecutiveNoGainRounds: 2, maxIterations: 8, keywordExpansionCount: 2, maxRelaxedHardConditions: 1 },
    {
      target: 20,
      eligible: 0,
      candidatePool: 3,
      newCreators: 1,
      newEligible: 0,
      sourceExhausted: false,
      quality: { evaluated: 48, failed: 45 },
      filters: { followers: { evaluated: 3, failed: 3 } },
    },
  );
  assert.notEqual(action.type, "soften_filter");
});

test("search loop expands keywords after a no-gain exhausted round", () => {
  const action = chooseSearchLoopAction(
    { iteration: 3, softenedFilters: new Set(), consecutiveNoGainRounds: 1, maxIterations: 12 },
    { target: 20, eligible: 2, candidatePool: 2, newCreators: 0, sourceExhausted: true, filters: {} },
  );
  assert.equal(action.type, "expand_keywords");
  assert.equal(expandedCreatorSearchKeywords(["光子嫩肤 体验"], "医美达人").length, 4);
});

test("search loop reacts to low match quality before relaxing business conditions", () => {
  const action = chooseSearchLoopAction(
    { iteration: 1, softenedFilters: new Set(), consecutiveNoGainRounds: 0, maxIterations: 12, keywordExpansionCount: 0, maxRelaxedHardConditions: 1 },
    {
      target: 20,
      eligible: 2,
      candidatePool: 20,
      newCreators: 20,
      sourceExhausted: false,
      quality: { evaluated: 20, failed: 18 },
      filters: { followers: { evaluated: 20, failed: 15 } },
    },
  );
  assert.equal(action.type, "expand_keywords");
  const first = expandedCreatorSearchKeywords(["光子嫩肤"], "医美素人", 1);
  const second = expandedCreatorSearchKeywords(first, "医美素人", 2);
  assert.ok(second.length > first.length);
  assert.ok(second.some((keyword) => keyword.includes("本人项目体验")));
});

test("search loop continues after three rounds without a new quality-approved creator", () => {
  const action = chooseSearchLoopAction(
    { iteration: 4, softenedFilters: new Set(["recent_likes"]), consecutiveNoGainRounds: 3, maxIterations: 8, keywordExpansionCount: 2, maxRelaxedHardConditions: 1 },
    { target: 20, eligible: 1, candidatePool: 4, newCreators: 4, newEligible: 0, sourceExhausted: false, quality: { evaluated: 60, failed: 56 }, filters: {} },
  );
  assert.equal(action.type, "search_more");
});

test("creator discovery uses RedFox realtime-search request fields", () => {
  assert.deepEqual(
    redfoxSearchRequestParams("/story/api/xhs/ability/searchWork", "光子嫩肤 素人 分享", 2, {}),
    { keyword: "光子嫩肤 素人 分享", note_type: "不限", noteTime: "不限", page: 2, sort: "综合" },
  );
});

test("realtime profile hydration uses documented account detail and skips note performance", async () => {
  class RealtimeClient extends RedfoxXhsClient {
    accountCalls = 0;
    noteDetailCalls = 0;
    override async searchNotes(): Promise<Record<string, unknown>> {
      return {
        code: 2000,
        data: {
          workList: [{
            authorUid: "creator-realtime-1",
            authorName: "千粉素人",
            noteId: "note-realtime-1",
            noteTitle: "我的光子嫩肤恢复记录",
            picUrls: ["https://example.invalid/note.webp"],
            thumbCount: 18,
            releaseTime: "2026-08-20T10:00:00.000Z",
          }],
        },
      };
    }
    override async getImageNoteDetail(): Promise<Record<string, unknown>> {
      this.noteDetailCalls += 1;
      throw new Error("undocumented note detail must not be used");
    }
    override async getUserInfo(): Promise<Record<string, unknown>> {
      this.accountCalls += 1;
      return { data: { accountUserid: "creator-realtime-1", accountNickname: "千粉素人", accountFans: 1850 } };
    }
  }

  const client = new RealtimeClient({
    apiKey: "test",
    searchPath: "/story/api/xhs/ability/searchWork",
    requestDelayMs: 300,
    maxPages: 1,
  });
  const batch = await client.searchNextNoteBatch(["光子嫩肤 素人 分享"], { desiredCreators: 1, pageBudget: 1 });
  assert.equal(batch.notes.length, 1);
  assert.equal(batch.notes[0].likes, 18);
  assert.equal(batch.notes[0].publishedAt, "2026-08-20T10:00:00.000Z");

  const enriched = await client.enrichNote(batch.notes[0]);
  assert.equal(enriched.noteId, "note-realtime-1");
  assert.equal(client.noteDetailCalls, 0);
  const hydration = await client.hydrateCreatorProfile(batch.notes[0]);
  assert.equal(hydration.profile?.fields.followers, 1850);
  assert.equal(hydration.profile?.fields.nickname, "千粉素人");
  assert.equal(hydration.accountDetailError, null);
  assert.equal(client.accountCalls, 1);
  assert.equal(client.noteDetailCalls, 0);
});

test("partial-result message explains every filter stage instead of a generic provider warning", () => {
  const message = creatorSearchPartialMessage({
    notes_collected: 75,
    creators_discovered: 74,
    candidates_started: 74,
    profile_failures: 1,
    follower_filtered: 65,
    follower_data_missing: 10,
    recent_likes_filtered: 0,
    posts_last_30d_filtered: 0,
    days_since_last_post_filtered: 0,
    semantic_filtered: 7,
    quality_filtered: 7,
    analysis_errors: 1,
    existing_duplicates: 0,
    persisted: 0,
  }, 20);
  assert.match(message, /55 个粉丝范围未达/);
  assert.match(message, /10 个粉丝数据缺失/);
  assert.match(message, /7 个内容语义条件未达/);
  assert.match(message, /新增 0\/20 人/);
  assert.match(message, /粉丝范围始终作为不可放宽的前置条件/);
  assert.match(message, /AI 语义匹配、有效证据和综合分门槛保持不变/);
});

test("candidate scores still penalize a missed business condition", () => {
  const exact = scoreCreatorCandidate({ followersMatched: true, recentLikesMatched: true, semanticMatched: true, semanticConfidence: 0.9, activityScore: 80, dataComplete: true });
  const followerMiss = scoreCreatorCandidate({ followersMatched: false, recentLikesMatched: true, semanticMatched: true, semanticConfidence: 0.9, activityScore: 80, dataComplete: true });
  const semanticMiss = scoreCreatorCandidate({ followersMatched: true, recentLikesMatched: true, semanticMatched: false, semanticConfidence: 0, activityScore: 80, dataComplete: true });
  assert.equal(exact, 97);
  assert.equal(followerMiss, 72);
  assert.equal(semanticMiss, 53);
  assert.ok(exact > followerMiss);
  assert.ok(followerMiss > semanticMiss);
});

test("followers stay hard even when they reject the most candidates", () => {
  const relaxed = selectDominantHardFilter({
    followersEnabled: true,
    recentLikesEnabled: true,
    followerFailures: 65,
    recentLikesFailures: 7,
  });
  assert.equal(relaxed, "recent_likes");
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: true,
    semanticRequired: true,
    followersMatched: false,
    recentLikesMatched: true,
    semanticMatched: true,
    relaxedHardFilter: relaxed,
  }), { passed: false, reason: "FOLLOWERS_HARD_FILTER" });
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: true,
    semanticRequired: true,
    followersMatched: true,
    recentLikesMatched: false,
    semanticMatched: true,
    relaxedHardFilter: relaxed,
  }), { passed: true, reason: null });
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: true,
    semanticRequired: true,
    followersMatched: false,
    recentLikesMatched: true,
    semanticMatched: false,
    relaxedHardFilter: relaxed,
  }), { passed: false, reason: "FOLLOWERS_HARD_FILTER" });
});

test("AI quality policy is bounded and keeps one-condition relaxation", () => {
  assert.deepEqual(creatorQualityPolicyFromIntent({
    qualityPolicy: {
      minimumOverallScore: 99,
      minimumSemanticConfidence: 0.2,
      requireEvidence: false,
    },
  }), {
    minimumOverallScore: 70,
    minimumSemanticConfidence: 0.55,
    requireEvidence: true,
    maximumRelaxedHardConditions: 1,
    source: "ai",
  });
});

test("semantic quality floor cannot be relaxed to fill twenty slots", () => {
  const qualityPolicy = creatorQualityPolicyFromIntent({
    qualityPolicy: { minimumOverallScore: 60, minimumSemanticConfidence: 0.65, requireEvidence: true },
  });
  assert.deepEqual(passesCreatorQualityGate({
    semanticRequired: true,
    semanticMatched: false,
    semanticConfidence: 0.95,
    semanticEvidenceCount: 3,
    rankingScore: 90,
    qualityPolicy,
  }), { passed: false, reason: "SEMANTIC_NOT_MATCHED" });
  assert.deepEqual(passesCreatorQualityGate({
    semanticRequired: true,
    semanticMatched: true,
    semanticConfidence: 0.6,
    semanticEvidenceCount: 2,
    rankingScore: 88,
    qualityPolicy,
  }), { passed: false, reason: "SEMANTIC_CONFIDENCE_BELOW_MINIMUM" });
  assert.deepEqual(passesCreatorQualityGate({
    semanticRequired: true,
    semanticMatched: true,
    semanticConfidence: 0.8,
    semanticEvidenceCount: 0,
    rankingScore: 88,
    qualityPolicy,
  }), { passed: false, reason: "SEMANTIC_EVIDENCE_REQUIRED" });
  assert.deepEqual(passesCreatorQualityGate({
    semanticRequired: true,
    semanticMatched: true,
    semanticConfidence: 0.8,
    semanticEvidenceCount: 2,
    rankingScore: 59,
    qualityPolicy,
  }), { passed: false, reason: "MINIMUM_QUALITY_SCORE" });
  assert.deepEqual(passesCreatorQualityGate({
    semanticRequired: true,
    semanticMatched: true,
    semanticConfidence: 0.8,
    semanticEvidenceCount: 2,
    rankingScore: 72,
    qualityPolicy,
  }), { passed: true, reason: null });
});

test("recent likes wins the relaxation when it rejects more candidates or ties", () => {
  assert.equal(selectDominantHardFilter({ followersEnabled: true, recentLikesEnabled: true, followerFailures: 3, recentLikesFailures: 4 }), "recent_likes");
  assert.equal(selectDominantHardFilter({ followersEnabled: true, recentLikesEnabled: true, followerFailures: 4, recentLikesFailures: 4 }), "recent_likes");
  assert.equal(selectDominantHardFilter({ followersEnabled: true, recentLikesEnabled: false, followerFailures: 0, recentLikesFailures: 99 }), null);
});

test("post activity hard filters participate in the same single-relaxation decision", () => {
  const relaxed = selectDominantHardFilter({
    followersEnabled: true,
    recentLikesEnabled: true,
    postsLast30dEnabled: true,
    daysSinceLastPostEnabled: true,
    followerFailures: 4,
    recentLikesFailures: 5,
    postsLast30dFailures: 12,
    daysSinceLastPostFailures: 8,
  });
  assert.equal(relaxed, "posts_last_30d");
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: true,
    postsLast30dEnabled: true,
    daysSinceLastPostEnabled: true,
    semanticRequired: true,
    followersMatched: true,
    recentLikesMatched: true,
    postsLast30dMatched: false,
    daysSinceLastPostMatched: true,
    semanticMatched: true,
    relaxedHardFilter: relaxed,
  }), { passed: true, reason: null });
  assert.deepEqual(passesCandidateGates({
    followersEnabled: true,
    recentLikesEnabled: true,
    postsLast30dEnabled: true,
    daysSinceLastPostEnabled: true,
    semanticRequired: true,
    followersMatched: true,
    recentLikesMatched: true,
    postsLast30dMatched: true,
    daysSinceLastPostMatched: false,
    semanticMatched: true,
    relaxedHardFilter: relaxed,
  }), { passed: false, reason: "DAYS_SINCE_LAST_POST_HARD_FILTER" });
});

test("missing optional constraints do not penalize a candidate", () => {
  assert.equal(scoreCreatorCandidate({ followersMatched: null, recentLikesMatched: null, semanticMatched: true, semanticConfidence: 1, activityScore: 100, dataComplete: true }), 100);
});

test("recentPostMetrics provides deterministic counts for activity hard filters", () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  assert.deepEqual(recentPostMetrics([
    { publishedAt: "2026-08-31T00:00:00.000Z" },
    { publishedAt: "2026-08-10T00:00:00.000Z" },
    { publishedAt: "2026-07-01T00:00:00.000Z" },
    {},
  ], now), { postsLast30d: 2, daysSinceLastPost: 1 });
  assert.deepEqual(recentPostMetrics([], now), { postsLast30d: 0, daysSinceLastPost: null });
});

test("top candidate selection returns twenty highest scores for human review", () => {
  const candidates = Array.from({ length: 35 }, (_, index) => ({ id: index, rankingScore: index }));
  const selected = selectTopCreatorCandidates(candidates, 20);
  assert.equal(selected.length, 20);
  assert.deepEqual(selected.map((item) => item.rankingScore), Array.from({ length: 20 }, (_, index) => 34 - index));
});

test("creator search policy has no default request or round ceiling", () => {
  assert.deepEqual(creatorSearchLoopPolicy(undefined), {
    maxRounds: null,
    requestLimit: null,
    stopMode: "quality_yield",
  });
  assert.equal(creatorSearchLoopPolicy(12).maxRounds, 12);
  const client = new RedfoxXhsClient({ apiKey: "test", maxRequestsPerSearch: 0 });
  assert.equal(client.getRemainingRequestBudget(), Number.POSITIVE_INFINITY);
});

test("search loop keeps exploring after three zero-yield waves", async () => {
  const { chooseSearchLoopAction } = await import("../src/creator-search-loop.js");
  const action = chooseSearchLoopAction({
    iteration: 3,
    softenedFilters: new Set(),
    consecutiveNoGainRounds: 3,
    maxIterations: Number.POSITIVE_INFINITY,
    keywordExpansionCount: 2,
    maxRelaxedHardConditions: 1,
  }, {
    target: 20,
    eligible: 0,
    candidatePool: 0,
    newCreators: 3,
    newEligible: 0,
    sourceExhausted: false,
    filters: {},
  });
  assert.equal(action.type, "search_more");
});

test("keyword expansion uses concrete topics instead of the full query text", async () => {
  const { expandedCreatorSearchKeywords } = await import("../src/creator-search-loop.js");
  const keywords = expandedCreatorSearchKeywords(
    ["光子嫩肤 体验 日记", "雀斑 改善 记录"],
    "1000-5000粉丝，做过光子嫩肤或者有雀斑，近三个月点赞10以上",
    1,
  );
  assert.ok(keywords.some((item) => item.startsWith("光子嫩肤 ")));
  assert.ok(keywords.some((item) => item.startsWith("雀斑 ")));
  assert.equal(keywords.some((item) => /博主内容涉及|\bor\b|近三个月点赞/.test(item)), false);
});

test("candidate analysis is capped per ReAct wave", () => {
  assert.equal(creatorCandidateAnalysisLimit(20, 0, 160), 24);
  assert.equal(creatorCandidateAnalysisLimit(20, 15, 160), 13);
  assert.equal(creatorCandidateAnalysisLimit(20, 0, 7), 7);
});

test("semantic preflight preserves evidence and confidence quality floors", () => {
  const qualityPolicy = { minimumOverallScore: 60, minimumSemanticConfidence: 0.62, requireEvidence: true, maximumRelaxedHardConditions: 1, source: "default" as const };
  assert.equal(passesSemanticPreflight({ semanticRequired: true, analysisComplete: true, matched: true, confidence: 0.7, evidenceCount: 1, qualityPolicy }), true);
  assert.equal(passesSemanticPreflight({ semanticRequired: true, analysisComplete: true, matched: true, confidence: 0.5, evidenceCount: 1, qualityPolicy }), false);
  assert.equal(passesSemanticPreflight({ semanticRequired: true, analysisComplete: true, matched: true, confidence: 0.7, evidenceCount: 0, qualityPolicy }), false);
});

test("semantic analysis separates any-match topics from code-owned data filters", () => {
  const prompt = creatorSemanticAnalysisQuery("1000-5000粉丝，近三个月点赞10以上", {
    hard_filters: { followers: { field: "followers", operator: "gte", value: 1000 } },
    semantic_conditions: [{ match: "any", terms: ["光子嫩肤", "雀斑"] }],
  });
  assert.match(prompt, /match=any/);
  assert.match(prompt, /光子嫩肤/);
  assert.match(prompt, /粉丝数、点赞数/);
});

test("search has no wall-clock cap unless an operator explicitly configures one", () => {
  assert.equal(searchMaxDurationMs(undefined), Number.POSITIVE_INFINITY);
  assert.equal(searchMaxDurationMs(0), Number.POSITIVE_INFINITY);
  assert.equal(searchMaxDurationMs("not-a-number"), Number.POSITIVE_INFINITY);
  assert.equal(searchMaxDurationMs(30_000), 60_000);
  assert.equal(searchMaxDurationMs(900_000), 900_000);
});

test("terminal finalization still closes the job when the task update fails", async () => {
  let jobFinalized = false;
  await assert.rejects(
    finalizeSearchExecution(
      async () => { throw new Error("invalid enum value"); },
      async () => { jobFinalized = true; },
    ),
    /invalid enum value/,
  );
  assert.equal(jobFinalized, true);
});

test("one accepted creator does not end a target-20 search", () => {
  assert.equal(shouldContinueCreatorSearch({ persisted: 1, target: 20, sourceExhausted: false }), true);
  assert.equal(shouldContinueCreatorSearch({ persisted: 20, target: 20, sourceExhausted: false }), false);
  assert.equal(shouldContinueCreatorSearch({ persisted: 1, target: 20, sourceExhausted: true }), false);
  assert.equal(shouldContinueCreatorSearch({ persisted: 1, target: 20, sourceExhausted: false, providerBudgetError: "budget" }), false);
});

test("model intent output cannot override the fixed twenty-creator batch target", () => {
  assert.deepEqual(normalizeCreatorIntent({ limit: 50, ranking: "相关度" }), {
    limit: 20,
    ranking: "相关度",
    qualityPolicy: { minimumOverallScore: 60, minimumSemanticConfidence: 0.62, requireEvidence: true, source: "default" },
  });
  assert.deepEqual(normalizeCreatorIntent(null), {
    limit: 20,
    qualityPolicy: { minimumOverallScore: 60, minimumSemanticConfidence: 0.62, requireEvidence: true, source: "default" },
  });
});

test("model intent supplies a bounded AI quality floor without disabling evidence", () => {
  assert.deepEqual(normalizeCreatorIntent({
    limit: 2,
    quality_policy: { minimum_overall_score: 72, minimum_semantic_confidence: 0.78, require_evidence: false },
  }), {
    limit: 20,
    quality_policy: { minimum_overall_score: 72, minimum_semantic_confidence: 0.78, require_evidence: false },
    qualityPolicy: { minimumOverallScore: 70, minimumSemanticConfidence: 0.78, requireEvidence: true, source: "ai" },
  });
});

test("a target-20 search keeps running until exactly twenty creators are accepted", () => {
  let persisted = 0;
  let waves = 0;
  while (shouldContinueCreatorSearch({ persisted, target: 20, sourceExhausted: false })) {
    persisted += Math.min(3, 20 - persisted);
    waves += 1;
  }
  assert.equal(persisted, 20);
  assert.equal(waves, 7);
});

test("provider credit exhaustion is not mislabeled as a local safety limit", () => {
  assert.equal(
    creatorSearchBudgetStopMessage("积分余额不足，剩余积分0.0", 3, 20),
    "RedFoxHub 积分余额不足，已保存检索位置；当前新增 3/20 人。充值后再次点击“开始检索”会从当前位置继续，不会重复筛查历史达人。",
  );
  assert.match(creatorSearchBudgetStopMessage("RedFox 调用上限 160", 3, 20), /本地安全调用上限/);
});

test("disabled RedFox API keys stop the search immediately", () => {
  assert.equal(isProviderBudgetExhausted("API Key已禁用"), true);
  assert.equal(isProviderCredentialError("API Key已禁用"), true);
  assert.match(creatorSearchBudgetStopMessage("API Key已禁用", 0, 20), /已禁用/);
  assert.match(creatorSearchBudgetStopMessage("API Key已禁用", 0, 20), /立即停止/);
});

test("search waves oversample the remaining target instead of stopping at ten candidates", () => {
  assert.deepEqual(creatorSearchWavePlan(20, 0, 32), { desiredCreators: 40, pageBudget: 4, minimumPages: 4 });
  assert.deepEqual(creatorSearchWavePlan(20, 1, 24), { desiredCreators: 38, pageBudget: 2, minimumPages: 1 });
  assert.deepEqual(creatorSearchWavePlan(20, 19, 24), { desiredCreators: 20, pageBudget: 1, minimumPages: 1 });
});

test("an exhausted session reopens when the keyword strategy adds new phrases", () => {
  const cursor = { nextPageByKeyword: { "光子嫩肤 体验 日记": 11 }, exhaustedKeywords: ["光子嫩肤 体验 日记"], nextKeywordIndex: 0 };
  assert.equal(isSearchSourceExhausted(true, cursor, ["光子嫩肤 体验 日记"]), true);
  assert.equal(isSearchSourceExhausted(true, cursor, ["光子嫩肤 体验 日记", "光子嫩肤 素人 分享"]), false);
});

test("project search history excludes every creator previously screened in the project", () => {
  const history = projectSearchHistoryFromRows([
    { note_key: "note:a", creator_platform_id: "creator-1" },
    { note_key: "note:b", creator_platform_id: "creator-2" },
    { note_key: "note:a", creator_platform_id: "creator-1" },
    { note_key: "", creator_platform_id: null },
  ]);

  assert.deepEqual([...history.noteKeys].sort(), ["note:a", "note:b"]);
  assert.deepEqual([...history.creatorIds].sort(), ["creator-1", "creator-2"]);
});

test("buildCreatorSearchKeywords fans out projects and skin concerns with personal-content signals", () => {
  const keywords = buildCreatorSearchKeywords({
    query: "1000-5000粉丝素人，做过光子嫩肤、超声炮、热玛吉、皮秒、点阵，或者有玫瑰皮肤、晒斑、雀斑",
    fallbackKeyword: "医美 光子嫩肤 超声炮",
    confirmedRule: {
      semantic_conditions: [{ terms: ["光子嫩肤", "超声炮", "玫瑰皮肤", "雀斑"] }],
    },
    structuredIntent: {
      semanticConditions: {
        hasMedicalBeauty: ["热玛吉", "皮秒"],
        hasSkinCondition: ["晒斑"],
      },
    },
  });

  assert.equal(keywords.length, 32);
  assert.deepEqual(keywords.slice(0, 8), [
    "光子嫩肤 体验 日记",
    "超声炮 体验 日记",
    "热玛吉 体验 日记",
    "皮秒 体验 日记",
    "点阵 体验 日记",
    "玫瑰皮肤 改善 记录",
    "晒斑 改善 记录",
    "雀斑 改善 记录",
  ]);
  for (const keyword of [
    "光子嫩肤 体验 日记",
    "光子嫩肤 真实 测评",
    "超声炮 素人 分享",
    "热玛吉 术后 恢复",
    "皮秒 真实 测评",
    "点阵 体验 日记",
    "玫瑰皮肤 改善 前后",
    "晒斑 皮肤 日记",
    "雀斑 改善 前后",
  ]) assert.ok(keywords.includes(keyword), `missing fallback keyword: ${keyword}`);
});

test("normalizeProfile uses every posted note's own title, likes and interactions", () => {
  const fallback: RedfoxNoteCandidate = {
    noteId: "seed-note",
    userId: "creator-1",
    nickname: "测试达人",
    handle: "test",
    profileUrl: "https://www.xiaohongshu.com/user/profile/creator-1",
    title: "搜索首条笔记",
    text: "搜索首条正文",
    imageUrls: ["https://example.invalid/seed.webp"],
    likes: 2,
    interaction: 3,
    noteType: "image",
    raw: { workPublishTime: "2026-08-01 10:00:00" },
  };

  const profile = normalizeProfile({
    accountUserid: "creator-1",
    accountNickname: "测试达人",
    workTitle: "作品列表中的真实标题",
    workLikedCount: 260,
    workCollectedCount: 12,
    workCommentsCount: 8,
    workSharedCount: 3,
    workPublishTime: "2026-08-20 10:00:00",
    coverUrl: "https://example.invalid/real.webp",
  }, fallback);

  assert.ok(profile);
  assert.equal(profile.fields.posts[0].title, "作品列表中的真实标题");
  assert.equal(profile.fields.posts[0].likes, 260);
  assert.equal(profile.fields.posts[0].interaction, 283);
  assert.deepEqual(profile.fields.posts[0].imageUrls, ["https://example.invalid/real.webp"]);
});

test("normalizeProfile reads nested RedFox follower metrics without using note likes", async () => {
  const { normalizeProfile } = await import("../src/redfox-xhs-client.js");
  const profile = normalizeProfile({
    accountUserid: "nested-creator",
    data: { accountInfo: { userId: "nested-creator", fans_count: "2,350" }, note: { title: "光子嫩肤体验" } },
  });
  assert.equal(profile?.fields.followers, 2350);
});

test("satisfiesRecentLikes checks likes only and respects the time window", () => {
  const condition = { field: "recent_likes", operator: "gte" as const, value: 10 };
  const now = Date.parse("2026-08-29T00:00:00+08:00");

  assert.equal(satisfiesRecentLikes([
    { likes: 2, publishedAt: "2026-08-20T00:00:00+08:00" },
  ], condition, 90, now), false);
  assert.equal(satisfiesRecentLikes([
    { likes: 12, publishedAt: "2026-08-20T00:00:00+08:00" },
  ], condition, 90, now), true);
  assert.equal(satisfiesRecentLikes([
    { likes: 999, publishedAt: "2026-01-01T00:00:00+08:00" },
  ], condition, 90, now), false);
});

test("searchNoteCandidates keeps successful keyword results when another keyword has no data", async () => {
  class TestClient extends RedfoxXhsClient {
    readonly calls: string[] = [];
    override async searchNotes(keyword: string): Promise<Record<string, unknown>> {
      this.calls.push(keyword);
      if (keyword.includes("晒斑")) throw new Error("优质库暂未收录该内容");
      return {
        code: 2000,
        data: {
          list: [{
            accountUserid: "creator-1",
            accountNickname: "测试达人",
            workId: "note-1",
            workTitle: "真实体验",
            workDesc: "光子嫩肤体验记录",
            workLikedCount: 20,
          }],
        },
      };
    }
  }

  const client = new TestClient({ apiKey: "test", requestDelayMs: 300, maxPages: 2 });
  const result = await client.searchNoteCandidates(["光子嫩肤 体验 日记", "晒斑 改善 记录"], 1);

  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].nickname, "测试达人");
  assert.deepEqual(result.keywordFailures, [{
    keyword: "晒斑 改善 记录",
    page: 1,
    error: "优质库暂未收录该内容",
  }]);
  assert.equal(client.calls.filter((keyword) => keyword.includes("晒斑")).length, 1);
  assert.equal(client.calls.filter((keyword) => keyword.includes("光子嫩肤")).length, 2);
});

test("selectRepresentativeNotes prefers a recent high-like note for each creator", () => {
  const base: RedfoxNoteCandidate = {
    noteId: "old",
    userId: "creator-1",
    nickname: "测试达人",
    handle: null,
    profileUrl: "https://www.xiaohongshu.com/user/profile/creator-1",
    title: "旧笔记",
    text: "旧笔记",
    imageUrls: [],
    likes: 999,
    interaction: 999,
    publishedAt: "2025-01-01T00:00:00.000Z",
    noteType: "unknown",
    raw: {},
  };
  const recent = {
    ...base,
    noteId: "recent",
    title: "我的热玛吉体验记录",
    text: "做完热玛吉后的恢复日记",
    likes: 20,
    publishedAt: new Date().toISOString(),
  };

  assert.equal(selectRepresentativeNotes([base, recent])[0].noteId, "recent");
});

test("profile hydration can stop after account detail and fetch works only on demand", async () => {
  class CountingClient extends RedfoxXhsClient {
    noteDetailCalls = 0;
    accountCalls = 0;
    workListCalls = 0;

    override async getImageNoteDetail(): Promise<Record<string, unknown>> {
      this.noteDetailCalls += 1;
      return {};
    }
    override async getUserInfo(): Promise<Record<string, unknown>> {
      this.accountCalls += 1;
      return { data: { accountUserid: "creator-1", accountNickname: "测试达人", accountFans: 2000 } };
    }
    override async getUserPostedNotes(): Promise<Record<string, unknown>> {
      this.workListCalls += 1;
      return {
        data: {
          list: [{
            accountUserid: "creator-1",
            accountNickname: "测试达人",
            workId: "note-2",
            workTitle: "另一篇近期作品",
            workLikedCount: 18,
            workPublishTime: new Date().toISOString(),
          }],
        },
      };
    }
  }

  const client = new CountingClient({ apiKey: "test", requestDelayMs: 300, maxPages: 1 });
  const note: RedfoxNoteCandidate = {
    noteId: "note-1",
    userId: "creator-1",
    nickname: "测试达人",
    handle: null,
    profileUrl: "https://www.xiaohongshu.com/user/profile/creator-1",
    title: "光子嫩肤体验",
    text: "我的真实体验",
    imageUrls: ["https://example.invalid/note.webp"],
    likes: 20,
    interaction: 25,
    publishedAt: new Date().toISOString(),
    noteType: "image",
    raw: { accountUserid: "creator-1", workId: "note-1", workTitle: "光子嫩肤体验" },
  };

  const account = await client.hydrateCreatorProfile(note, { includePostedNotes: false, includeNoteDetail: false });
  assert.ok(account.profile);
  assert.equal(account.profile.fields.followers, 2000);
  assert.equal(client.accountCalls, 1);
  assert.equal(client.noteDetailCalls, 0);
  assert.equal(client.workListCalls, 0);

  const withWorks = await client.hydrateCreatorPostedNotes(note, account.profile);
  assert.equal(withWorks.profile.fields.posts.length, 2);
  assert.equal(client.workListCalls, 1);
});

test("creatorSearchKey is stable when confirmed-rule object keys have different order", () => {
  const left = creatorSearchKey("project-1", "  光子嫩肤   体验  ", { b: 2, a: { y: 2, x: 1 } });
  const right = creatorSearchKey("project-1", "光子嫩肤 体验", { a: { x: 1, y: 2 }, b: 2 });
  assert.equal(left, right);
});

test("pending-save strategy uses a fresh search-session namespace", () => {
  assert.equal(CREATOR_SEARCH_STRATEGY_VERSION, "redfox-realtime-v4-pending-save");
});

test("search session progress persists and clears unprocessed candidates", async () => {
  let patch: Record<string, unknown> | null = null;
  const client = {
    from: () => ({
      update: (value: Record<string, unknown>) => {
        patch = value;
        return { eq: async () => ({ error: null }) };
      },
    }),
  } as never;
  const cursor = { nextPageByKeyword: { 光子嫩肤: 2 }, exhaustedKeywords: [], nextKeywordIndex: 0 };
  const note = { noteId: "n-1", userId: "u-1", nickname: "测试", handle: null, profileUrl: "https://xhs/u-1", title: "体验", text: "本人体验记录", imageUrls: [], likes: 20, interaction: 20, noteType: "image", raw: {} };
  await saveSearchSessionProgress(client, "session-1", cursor, false, ["光子嫩肤"], { notes: [note], cursor, sourceExhausted: false });
  assert.equal((patch?.cursor_state as Record<string, unknown>).pending !== undefined, true);
  await saveSearchSessionProgress(client, "session-1", cursor, true, ["光子嫩肤"], null);
  assert.equal((patch?.cursor_state as Record<string, unknown>).pending, undefined);
});

test("searchNextNoteBatch keeps paging until it has at least twenty unique creators", async () => {
  class TwentyCreatorClient extends RedfoxXhsClient {
    readonly calls: Array<{ keyword: string; page: number }> = [];
    override async searchNotes(keyword: string, page = 1): Promise<Record<string, unknown>> {
      this.calls.push({ keyword, page });
      const start = (page - 1) * 7;
      return {
        data: {
          workList: Array.from({ length: 7 }, (_, index) => ({
            authorUid: `creator-${start + index + 1}`,
            authorName: `creator ${start + index + 1}`,
            noteId: `note-${start + index + 1}`,
            noteTitle: "personal skincare experience",
            thumbCount: 20,
          })),
        },
      };
    }
  }

  const client = new TwentyCreatorClient({ apiKey: "test", requestDelayMs: 300, maxPages: 10 });
  const result = await client.searchNextNoteBatch(["medical beauty"], {
    desiredCreators: 20,
    pageBudget: 4,
  });

  assert.equal(result.notes.length, 21);
  assert.deepEqual(client.calls, [
    { keyword: "medical beauty", page: 1 },
    { keyword: "medical beauty", page: 2 },
    { keyword: "medical beauty", page: 3 },
  ]);
  assert.equal(result.sourceExhausted, false);
});

test("the first batch covers the configured number of topic pages before ranking", async () => {
  class TopicCoverageClient extends RedfoxXhsClient {
    readonly calls: string[] = [];
    override async searchNotes(keyword: string): Promise<Record<string, unknown>> {
      this.calls.push(keyword);
      return {
        data: {
          workList: Array.from({ length: 20 }, (_, index) => ({
            authorUid: `${keyword}-creator-${index}`,
            authorName: `${keyword} creator ${index}`,
            noteId: `${keyword}-note-${index}`,
            noteTitle: `${keyword} personal experience`,
          })),
        },
      };
    }
  }

  const keywords = Array.from({ length: 8 }, (_, index) => `topic-${index + 1}`);
  const client = new TopicCoverageClient({ apiKey: "test", requestDelayMs: 300, maxPages: 10 });
  const result = await client.searchNextNoteBatch(keywords, {
    desiredCreators: 80,
    pageBudget: 8,
    minimumPages: 8,
  });
  assert.equal(client.calls.length, 8);
  assert.deepEqual(client.calls, keywords);
  assert.equal(result.notes.length, 160);
});

test("searchNextNoteBatch rotates keywords, advances cursors, and excludes screened creators", async () => {
  class PagingClient extends RedfoxXhsClient {
    readonly calls: Array<{ keyword: string; page: number }> = [];
    override async searchNotes(keyword: string, page = 1): Promise<Record<string, unknown>> {
      this.calls.push({ keyword, page });
      return {
        data: {
          list: [
            { accountUserid: `${keyword}-${page}-a`, workId: `${keyword}-${page}-note-a`, workTitle: "体验A" },
            { accountUserid: `${keyword}-${page}-b`, workId: `${keyword}-${page}-note-b`, workTitle: "体验B" },
          ],
        },
      };
    }
  }

  const client = new PagingClient({ apiKey: "test", requestDelayMs: 300, maxPages: 3 });
  const first = await client.searchNextNoteBatch(["光子", "皮秒"], { desiredCreators: 1, pageBudget: 2 });
  assert.deepEqual(client.calls, [{ keyword: "光子", page: 1 }]);
  assert.equal(first.notes.length, 2, "a fetched page must not discard candidates after the desired threshold");
  assert.equal(first.cursor.nextKeywordIndex, 1);
  assert.equal(first.cursor.nextPageByKeyword["光子"], 2);

  const second = await client.searchNextNoteBatch(["光子", "皮秒"], {
    cursor: first.cursor,
    excludedCreatorIds: first.notes.map((note) => note.userId),
    desiredCreators: 1,
    pageBudget: 2,
  });
  assert.deepEqual(client.calls.at(-1), { keyword: "皮秒", page: 1 });
  assert.equal(second.notes.length, 2);
  assert.equal(second.cursor.nextPageByKeyword["皮秒"], 2);
});

test("searchNextNoteBatch advances past a page containing only project-history creators", async () => {
  class HistoryPagingClient extends RedfoxXhsClient {
    readonly calls: number[] = [];
    override async searchNotes(_keyword: string, page = 1): Promise<Record<string, unknown>> {
      this.calls.push(page);
      return {
        data: {
          list: page === 1
            ? [{ accountUserid: "old-creator", workId: "old-note", workTitle: "历史结果" }]
            : [{ accountUserid: "new-creator", workId: "new-note", workTitle: "新的素人分享" }],
        },
      };
    }
  }

  const client = new HistoryPagingClient({ apiKey: "test", requestDelayMs: 300, maxPages: 3 });
  const result = await client.searchNextNoteBatch(["光子嫩肤 素人 分享"], {
    excludedCreatorIds: ["old-creator"],
    desiredCreators: 1,
    pageBudget: 2,
  });

  assert.deepEqual(client.calls, [1, 2]);
  assert.deepEqual(result.notes.map((note) => note.userId), ["new-creator"]);
  assert.equal(result.cursor.nextPageByKeyword["光子嫩肤 素人 分享"], 3);
});

test("searchNextNoteBatch continues with long-tail keywords after the first eight are exhausted", async () => {
  class ExpandedKeywordClient extends RedfoxXhsClient {
    readonly calls: Array<{ keyword: string; page: number }> = [];
    override async searchNotes(keyword: string, page = 1): Promise<Record<string, unknown>> {
      this.calls.push({ keyword, page });
      return {
        data: {
          list: [{
            accountUserid: `creator-${keyword}`,
            workId: `note-${keyword}`,
            workTitle: "新的长尾关键词结果",
          }],
        },
      };
    }
  }

  const keywords = Array.from({ length: 24 }, (_, index) => `keyword-${index + 1}`);
  const exhaustedKeywords = keywords.slice(0, 8);
  const nextPageByKeyword = Object.fromEntries(exhaustedKeywords.map((keyword) => [keyword, 11]));
  const client = new ExpandedKeywordClient({ apiKey: "test", requestDelayMs: 300, maxPages: 10 });
  const result = await client.searchNextNoteBatch(keywords, {
    cursor: { nextPageByKeyword, exhaustedKeywords, nextKeywordIndex: 0 },
    desiredCreators: 1,
    pageBudget: 1,
  });

  assert.deepEqual(client.calls, [{ keyword: "keyword-9", page: 1 }]);
  assert.equal(result.notes.length, 1);
  assert.equal(result.notes[0].userId, "creator-keyword-9");
  assert.equal(result.sourceExhausted, false);
});

test("regression: the exact medical-beauty query reopens an old eight-keyword exhausted cursor", async () => {
  class RegressionClient extends RedfoxXhsClient {
    readonly calls: string[] = [];
    override async searchNotes(keyword: string): Promise<Record<string, unknown>> {
      this.calls.push(keyword);
      return { data: { list: [{ accountUserid: "new-creator", workId: "new-note", workTitle: "新的素人真实分享" }] } };
    }
  }

  const query = "1000-5000粉丝左右的博主，做过医美（光子嫩肤/超声炮/热玛吉/皮秒/点阵等医美项目）或者玫瑰皮肤/晒斑皮肤/雀斑皮肤等皮肤较差的，需要有发过类似的笔记，近三个月笔记点赞10个以上";
  const keywords = buildCreatorSearchKeywords({
    query,
    fallbackKeyword: "医美",
    structuredIntent: { semanticConditions: ["做过医美", "皮肤较差"], limit: 50 },
  });
  const exhaustedKeywords = [
    "光子嫩肤 体验 日记",
    "超声炮 体验 日记",
    "热玛吉 体验 日记",
    "皮秒 体验 日记",
    "点阵 体验 日记",
    "玫瑰皮肤 改善 记录",
    "晒斑 改善 记录",
    "雀斑 改善 记录",
  ];
  const cursor = { nextPageByKeyword: {}, exhaustedKeywords, nextKeywordIndex: 0 };
  assert.equal(keywords.length, 32);
  assert.equal(isSearchSourceExhausted(true, cursor, keywords), false);

  const client = new RegressionClient({ apiKey: "test", requestDelayMs: 300, maxPages: 10 });
  const result = await client.searchNextNoteBatch(keywords, { cursor, desiredCreators: 1, pageBudget: 1 });
  assert.equal(result.notes.length, 1);
  assert.equal(client.calls.length, 1);
  assert.ok(!exhaustedKeywords.includes(client.calls[0]));
});
