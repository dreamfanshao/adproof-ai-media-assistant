import type { CreatorHardFilter, RelaxableHardFilter } from "./redfox-search-executor.js";

export type SearchLoopAction =
  | { type: "search_more"; pageBudget: number }
  | { type: "expand_keywords"; reason: string }
  | { type: "soften_filter"; filter: RelaxableHardFilter; reason: string }
  | { type: "finalize"; reason: string }
  | { type: "stop"; reason: string };

export interface SearchLoopFilterStats {
  evaluated: number;
  failed: number;
}

export interface SearchLoopObservation {
  target: number;
  eligible: number;
  candidatePool: number;
  newCreators: number;
  newEligible?: number;
  sourceExhausted: boolean;
  providerBudgetError?: boolean;
  quality?: SearchLoopFilterStats;
  filters: Partial<Record<CreatorHardFilter, SearchLoopFilterStats>>;
}

export interface SearchLoopDecisionState {
  iteration: number;
  softenedFilters: ReadonlySet<RelaxableHardFilter>;
  consecutiveNoGainRounds: number;
  maxIterations: number;
  keywordExpansionCount?: number;
  maxRelaxedHardConditions?: number;
}

// Follower range is never softenable. It is the primary small/personal creator
// gate and is evaluated before AI analysis.
const FILTER_ORDER: RelaxableHardFilter[] = ["recent_likes", "posts_last_30d", "days_since_last_post"];

/**
 * Chooses one bounded action from the current observation. This is the
 * deterministic guardrail around the Agent Loop: a future LLM planner may
 * suggest an action, but it must still pass through this policy.
 */
export function chooseSearchLoopAction(
  state: SearchLoopDecisionState,
  observation: SearchLoopObservation,
): SearchLoopAction {
  if (observation.eligible >= observation.target) {
    return { type: "finalize", reason: "候选池已达到目标数量" };
  }

  if (observation.providerBudgetError) {
    return { type: "stop", reason: "服务商预算或限流已触发" };
  }

  const quality = observation.quality ?? { evaluated: 0, failed: 0 };
  const qualityFailureRate = quality.evaluated > 0 ? quality.failed / quality.evaluated : 0;
  if (quality.failed >= 5
    && qualityFailureRate >= 0.5
    && (observation.newEligible ?? 0) === 0
    && (state.keywordExpansionCount ?? 0) < 2) {
    return { type: "expand_keywords", reason: `最低匹配标准淘汰 ${quality.failed}/${quality.evaluated} 个候选，优先收紧检索表达` };
  }

  const dominant = FILTER_ORDER
    .filter((filter) => !state.softenedFilters.has(filter))
    .map((filter) => {
      const stats = observation.filters[filter] ?? { evaluated: 0, failed: 0 };
      const rate = stats.evaluated > 0 ? stats.failed / stats.evaluated : 0;
      return { filter, ...stats, rate };
    })
    .filter((item) => item.evaluated >= 2 && item.failed >= 2 && item.rate >= 0.6)
    .sort((left, right) => right.failed - left.failed || right.rate - left.rate)[0];
  const softenedSecondaryFilterCount = state.softenedFilters.size;

  if (dominant
    && observation.eligible < observation.target
    && softenedSecondaryFilterCount < (state.maxRelaxedHardConditions ?? 1)) {
    return {
      type: "soften_filter",
      filter: dominant.filter,
      reason: `${dominant.filter} 淘汰 ${dominant.failed}/${dominant.evaluated} 个候选，当前仍不足 ${observation.target} 人`,
    };
  }

  if (state.iteration >= state.maxIterations) {
    return { type: "stop", reason: `达到最大循环次数 ${state.maxIterations}` };
  }

  if (observation.sourceExhausted) {
    if ((state.keywordExpansionCount ?? 0) >= 2) {
      return { type: "stop", reason: "关键词与两轮质量扩展均已耗尽，停止用低质量候选补足数量" };
    }
    return { type: "expand_keywords", reason: "当前关键词分页已耗尽，尝试长尾关键词" };
  }

  if (observation.newCreators === 0
    && state.consecutiveNoGainRounds >= 1
    && (state.keywordExpansionCount ?? 0) < 2) {
    return { type: "expand_keywords", reason: "上一轮没有新增达人，切换检索表达" };
  }

  return { type: "search_more", pageBudget: observation.newCreators > 0 ? 2 : 1 };
}

export function expandedCreatorSearchKeywords(current: string[], query: string, expansionRound = 1): string[] {
  const base = current.map((item) => item.trim()).filter(Boolean);
  // Expand only concrete topics. Appending the whole natural-language query
  // produces terms such as "or" and "博主内容涉及", which pollute RedFox
  // recall and spend pages on unrelated results.
  const topicPattern = /光子嫩肤|超声炮|热玛吉|皮秒|点阵|玫瑰痤疮|玫瑰皮肤|晒斑|雀斑/g;
  const topicTokenPattern = /光子嫩肤|超声炮|热玛吉|皮秒|点阵|玫瑰痤疮|玫瑰皮肤|晒斑|雀斑/;
  const topics = Array.from(new Set([
    ...(query.match(topicPattern) ?? []),
    ...base.map((item) => item.split(/\s+/)[0]).filter((item) => topicTokenPattern.test(item)),
  ]));
  const suffixes = expansionRound > 1
    ? ["本人项目体验 过程记录", "本人经历 记录", "皮肤改善 日记", "术后恢复 分享"]
    : ["本人体验 记录", "真实经历 分享", "皮肤改善 日记", "术后恢复 过程"];
  const additions = topics.flatMap((topic) => suffixes.map((suffix) => `${topic} ${suffix}`));
  return Array.from(new Set(expansionRound > 1 ? [...additions, ...base] : additions)).slice(0, 32);
}
