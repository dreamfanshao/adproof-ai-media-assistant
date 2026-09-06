export interface NumericComparison {
  operator: "lt" | "lte" | "eq" | "gte" | "gt";
  value: number;
}
export interface SemanticCondition {
  id: string;
  type: "experience" | "concern" | "content_topic" | "persona" | "custom";
  terms: string[];
  match: "any" | "all" | "none";
}
export interface ParsedSearchRule {
  hard_filters: {
    followers?: NumericComparison;
    followers_max?: NumericComparison;
    posts_last_30d?: NumericComparison;
    days_since_last_post?: NumericComparison;
    /** 最近一段时间内至少一篇笔记的点赞/互动数门槛。 */
    recent_likes?: NumericComparison;
    recent_likes_window_days?: number;
  };
  semantic_conditions: SemanticCondition[];
  ranking: Array<{ field: "activity" | "followers" | "match_score" | "recent_post_at"; direction: "asc" | "desc" }>;
  limit: number;
  ambiguities: string[];
  schema_version: "search-rule.v1";
}
const numberPattern = "([0-9]{1,9}(?:,[0-9]{3})*)";
function toNumber(value: string) { return Number.parseInt(value.replace(/,/g, ""), 10); }
function splitClauses(raw: string): string[] {
  return raw.replace(/[；;]/g, "，").split(/[，,。\n]+|\s+(?:并且|以及|同时)\s+/).map((item) => item.trim()).filter(Boolean);
}
function cleanClause(value: string) {
  return value.replace(/^(?:你是[^，,。]*[，,。])/, "").replace(/^(?:我想|我要|请帮我|帮我|需要|寻找|找|筛选|希望找)\s*/, "").replace(/(?:左右的)?(?:素人)?(?:博主|达人)(?:，|,|。)?$/, "").replace(/(?:，|,)?(?:需要|要求)有?发过类似的笔记.*$/, "").replace(/(?:，|,)?近[一二两三四五六七八九十0-9]+个?月.*$/, "").replace(/^(?:有?发过类似的笔记.*|类似的笔记.*)$/, "").trim();
}
function addSemantic(rawClause: string, semanticConditions: SemanticCondition[], ambiguities: string[]) {
  const clause = cleanClause(rawClause).replace(/[（）()]/g, " "); if (!clause || clause.length < 2) return;
  const negative = /^(?:不要|不需要|排除|没有)/.test(clause);
  const withoutNegation = clause.replace(/^(?:不要|不需要|排除|没有)\s*/, "").trim();
  const terms = withoutNegation.split(/(?:或者|以及|或|和|、|\/|\||\s{2,})/).map((term) => term.trim().replace(/^者/, "")).filter((term) => term.length >= 2).map((term) => term.replace(/^(?:做过|有过|经历过|涉及|关于|具备)/, "").trim()).filter(Boolean);
  if (!terms.length) { ambiguities.push(`未能解析的子句：${rawClause}`); return; }
  const type: SemanticCondition["type"] = /做过|有过|经历过|使用过|擅长/.test(rawClause) ? "experience" : /困扰|问题|肤质|斑/.test(rawClause) ? "concern" : /素人|达人|博主|身份/.test(rawClause) ? "persona" : "content_topic";
  semanticConditions.push({ id: `c${semanticConditions.length + 1}`, type, terms: [...new Set(terms)], match: negative ? "none" : "any" });
}
export function parseSearchRuleHeuristic(raw: string, defaultLimit = 50): ParsedSearchRule {
  const ambiguities: string[] = []; const hardFilters: ParsedSearchRule["hard_filters"] = {}; const semanticConditions: SemanticCondition[] = []; const ranking: ParsedSearchRule["ranking"] = []; let limit = defaultLimit;
  for (const clause of splitClauses(raw)) {
    const range = clause.match(new RegExp(`${numberPattern}\\s*(?:-|~|至|到)\\s*${numberPattern}\\s*粉丝`));
    if (range) { hardFilters.followers = { operator: "gte", value: toNumber(range[1]) }; hardFilters.followers_max = { operator: "lte", value: toNumber(range[2]) }; continue; }
    const max = clause.match(new RegExp(`(?:粉丝|followers?)?\\s*(?:小于|少于|低于|不超过|<)\\s*${numberPattern}`));
    if (max) { hardFilters.followers = { operator: "lt", value: toNumber(max[1]) }; continue; }
    const min = clause.match(new RegExp(`(?:粉丝|followers?)?\\s*(?:大于|超过|高于|>)\\s*${numberPattern}`));
    if (min) { hardFilters.followers = { operator: "gt", value: toNumber(min[1]) }; continue; }
    const count = clause.match(/^(\d{1,2})\s*(?:人|个)?$/); if (count) { limit = Number.parseInt(count[1], 10); continue; }
    if (/活跃度|活跃|更新频率/.test(clause)) { ranking.push({ field: "activity", direction: /低|少/.test(clause) ? "asc" : "desc" }); continue; }
    if (/近[一二两三四五六七八九十0-9]+个?月|近30天|点赞|获赞|互动|发帖|发布笔记|笔记数量/.test(clause)) {
      const likes = clause.match(/(?:点赞|获赞|互动)\s*(?:不少于|大于|超过|>=|至少)?\s*(\d+)/);
      const explicitPostCount = clause.match(/(?:发帖|发布(?:了)?(?:笔记|内容)|笔记数量)\s*(?:不少于|大于|超过|>=|至少)?\s*(\d+)/);
      if (likes) {
        const windowMatch = clause.match(/近\s*(三|3|两|二|2|一|1|四|4|五|5|六|6|七|7|八|8|九|9|十|10)\s*个?月/);
        const windowToken = windowMatch?.[1];
        const months = windowToken ? ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[windowToken] ?? Number(windowToken) : undefined;
        hardFilters.recent_likes = { operator: "gte", value: Number.parseInt(likes[1], 10) };
        hardFilters.recent_likes_window_days = /近\s*30\s*天/.test(clause) ? 30 : (months ? months * 30 : 30);
      } else if (explicitPostCount) {
        hardFilters.posts_last_30d = { operator: "gte", value: Number.parseInt(explicitPostCount[1], 10) };
      }
      addSemantic(clause, semanticConditions, ambiguities); continue;
    }
    addSemantic(clause, semanticConditions, ambiguities);
  }
  if (!ranking.length) ranking.push({ field: "match_score", direction: "desc" });
  return { hard_filters: hardFilters, semantic_conditions: semanticConditions, ranking, limit, ambiguities, schema_version: "search-rule.v1" };
}
function normalizeSearchKeywordTerm(value: string) { return cleanClause(value).replace(/^(?:粉丝|活跃度|近30天|近三个月|需要|要求)\s*/, "").trim(); }
export function extractSearchKeyword(raw: string, rule: ParsedSearchRule): string {
  const terms = rule.semantic_conditions.flatMap((condition) => condition.terms).map(normalizeSearchKeywordTerm).filter((term) => term.length >= 2).filter((term) => !/^(?:高级)?媒介专员$|^媒介$|^达人$|^博主$|^素人$/.test(term));
  const keyword = [...new Set(terms)].slice(0, 3).join(" ").trim(); if (keyword) return keyword.slice(0, 120);
  const fallback = raw.replace(/粉丝\s*(?:小于|少于|不超过|大于|超过|<|>)?\s*[0-9,]+/g, " ").replace(/(?:你是|我想|我要|请帮我|需要|寻找|找|筛选)/g, " ").replace(/[，,。；;、]+/g, " ").replace(/\s+/g, " ").trim(); return fallback.slice(0, 120) || "热门";
}