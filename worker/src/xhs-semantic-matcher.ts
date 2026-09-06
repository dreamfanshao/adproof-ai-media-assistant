// T07 Phase 2｜语义条件判定与 match_score 合成（Workflow B，技术方案 §13.3）
// AI 只判断语义条件命中；match_score 由确定性代码合成，模型不返回最终排序分。
// 默认使用启发式判定（可测试、无密钥依赖）；OPENAI_API_KEY 配置后可切换 LLM 判定。
import type { CreatorProfileFields } from "./xhs-field-mapper.js";

export interface SemanticCondition {
  id: string;
  type: "experience" | "concern" | "content_topic" | "persona" | "custom";
  terms: string[];
  match: "any" | "all" | "none";
}

export interface SemanticVerdict {
  condition_id: string;
  verdict: "matched" | "not_matched";
  confidence: number;
  evidence_ids: string[];
  reason: string;
}

export interface SemanticMatchResult {
  conditions: SemanticVerdict[];
  activity: { score: number; posts: number; medianInteraction: number | null };
  matchScore: number;
  evidenceSummary: string;
  schemaVersion: "creator-semantic-match.v1";
  matcher: "heuristic" | "llm";
}

export const SEMANTIC_SCHEMA_VERSION = "creator-semantic-match.v1" as const;
export const MATCHER_VERSION = "heuristic-v1";

const SEMANTIC_WEIGHT = 0.5;
const ACTIVITY_WEIGHT = 0.25;
const EVIDENCE_WEIGHT = 0.25;

/** 确定性活跃度（MVP 代理）：首屏笔记量 + 中位互动，阈值待本地 Eval 校准 */
export function computeActivityScore(posts: Array<{ interaction: number | null }>): {
  score: number;
  medianInteraction: number | null;
} {
  const interactions = posts
    .map((p) => p.interaction)
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);
  const median =
    interactions.length === 0
      ? null
      : interactions.length % 2 === 1
        ? interactions[Math.floor(interactions.length / 2)]
        : Math.round((interactions[interactions.length / 2 - 1] + interactions[interactions.length / 2]) / 2);
  const postsScore = Math.min(1, posts.length / 12);
  const interactionScore = median === null ? 0 : Math.min(1, median / 200);
  const score = Math.round(100 * (0.6 * postsScore + 0.4 * interactionScore));
  return { score, medianInteraction: median };
}

interface CorpusItem {
  id: string;
  text: string;
}

function corpusFor(creator: CreatorProfileFields): CorpusItem[] {
  const items: CorpusItem[] = [{ id: "bio", text: creator.bio ?? "" }];
  creator.posts.forEach((post, index) => items.push({ id: `p${index + 1}`, text: post.title }));
  return items.filter((item) => item.text.length > 0);
}

/** 启发式语义判定：检索词对简介/笔记标题做子串匹配（中文场景子串命中即可） */
export function judgeSemanticConditionsHeuristic(
  conditions: SemanticCondition[],
  creator: CreatorProfileFields,
): SemanticVerdict[] {
  const corpus = corpusFor(creator);
  return conditions.map((cond) => {
    const termHits = cond.terms.map((term) => corpus.filter((item) => item.text.includes(term)));
    let hit: boolean;
    switch (cond.match) {
      case "all":
        hit = cond.terms.every((_, index) => termHits[index].length > 0);
        break;
      case "none":
        hit = cond.terms.every((_, index) => termHits[index].length === 0);
        break;
      default:
        hit = termHits.some((hits) => hits.length > 0);
    }
    const evidenceIds = Array.from(new Set(termHits.flat().map((item) => item.id))).slice(0, 5);
    const titleHitCount = termHits.flat().filter((item) => item.id.startsWith("p")).length;
    const bioHit = termHits.some((hits) => hits.some((item) => item.id === "bio"));
    const confidence = hit
      ? Math.min(0.95, 0.55 + titleHitCount * 0.1 + (bioHit ? 0.15 : 0))
      : 0.9;
    const reason = hit
      ? evidenceIds.includes("bio")
        ? "简介或笔记内容命中检索主题"
        : "近期笔记内容命中检索主题"
      : "未在简介与近期笔记中发现相关主题";
    return {
      condition_id: cond.id,
      verdict: hit ? "matched" : "not_matched",
      confidence: Math.round(confidence * 100) / 100,
      evidence_ids: evidenceIds,
      reason,
    };
  });
}

/** 确定性合成 match_score（0–100）：语义命中率 50% + 活跃度 25% + 证据充分度 25% */
export function composeMatchScore(
  verdicts: SemanticVerdict[],
  creator: CreatorProfileFields,
  activityScore: number,
): number {
  const semanticHitRatio = verdicts.length === 0 ? 1 : verdicts.filter((v) => v.verdict === "matched").length / verdicts.length;
  const evidenceScore = creator.dataCompleteness === "complete" ? 1 : 0.5;
  const score = Math.round(
    100 * (SEMANTIC_WEIGHT * semanticHitRatio + ACTIVITY_WEIGHT * (activityScore / 100) + EVIDENCE_WEIGHT * evidenceScore),
  );
  return Math.min(100, Math.max(0, score));
}

export function buildEvidenceSummary(
  verdicts: SemanticVerdict[],
  conditions: SemanticCondition[],
): string {
  const matched = verdicts.filter((v) => v.verdict === "matched");
  if (matched.length === 0) return "未发现与检索条件相关的主题内容";
  return matched
    .map((v) => {
      const cond = conditions.find((c) => c.id === v.condition_id);
      return `命中「${cond?.terms.join(" / ") ?? v.condition_id}」（置信度 ${v.confidence}）`;
    })
    .join("；");
}

/** 语义条件判定 + 活跃度 + match_score 合成（Phase 2 默认：启发式） */
export function analyzeCreatorMatch(
  conditions: SemanticCondition[],
  creator: CreatorProfileFields,
): SemanticMatchResult {
  const activity = computeActivityScore(creator.posts);
  const verdicts = judgeSemanticConditionsHeuristic(conditions, creator);
  const matchScore = composeMatchScore(verdicts, creator, activity.score);
  const evidenceSummary = buildEvidenceSummary(verdicts, conditions);
  return {
    conditions: verdicts,
    activity: { score: activity.score, posts: creator.posts.length, medianInteraction: activity.medianInteraction },
    matchScore,
    evidenceSummary,
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    matcher: "heuristic",
  };
}
