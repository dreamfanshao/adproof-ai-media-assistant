// 本地 Eval Runner：多套件 + 多评分方法（精准匹配 / 余弦相似度 / LLM-as-judge / 人工评估）
import { readFileSync } from "node:fs";
import { parseSearchRuleHeuristic } from "../server/src/services/rule-parser.js";
import { AUDIT_RULES } from "../server/src/services/audit-rules.js";
import { analyzeCreatorMatch } from "../worker/src/xhs-semantic-matcher.js";
import { AUDIT_RULE_CASES, RULE_PARSE_CASES, SEMANTIC_MATCH_CASES } from "./datasets.js";
import { loadSettings, type EvalSettings } from "./storage.js";

export type ScoringMethod = "exact_match" | "cosine_similarity" | "llm_as_judge" | "human_eval";

export interface EvalCaseResult {
  id: string;
  pass: boolean;
  status?: "PASS" | "FAIL" | "REVIEW" | "ERROR";
  scoringMethod: ScoringMethod;
  input: string;
  expected: string;
  actual: string;
  detail: string;
}

export interface EvalSuiteResult {
  id: string;
  name: string;
  total: number;
  passed: number;
  cases: EvalCaseResult[];
  metrics?: Record<string, number | string>;
}

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

// ---------- 字符 bigram 余弦相似度（中文无 Embedding 时的代理） ----------
function bigram(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const clean = text.replace(/\s+/g, "");
  for (let i = 0; i < clean.length - 1; i += 1) {
    const g = clean.slice(i, i + 2);
    map.set(g, (map.get(g) ?? 0) + 1);
  }
  return map;
}
export function cosineSimilarity(a: string, b: string): number {
  const ma = bigram(a);
  const mb = bigram(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [k, v] of ma) { dot += v * (mb.get(k) ?? 0); na += v * v; }
  for (const v of mb.values()) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- LLM-as-judge（OpenAI 兼容；未配置 Key 时返回 pending） ----------
export interface LlmJudgeResult {
  status: "scored" | "pending_llm";
  scores?: { correctness: number; relevance: number; completeness: number; safety: number; tone: number; overall: number };
  reason?: string;
  note?: string;
}

export async function llmJudge(input: string, output: string, expected: string): Promise<LlmJudgeResult> {
  const env = loadEnv();
  const settings = loadSettings();
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return { status: "pending_llm", note: "未配置 OPENAI_API_KEY，跳过 LLM 评分（可先在“评分方法/设置”编辑 prompt 并配置后启用）" };
  }
  const prompt = settings.judgePrompt
    .replaceAll("{input}", input.slice(0, 500))
    .replaceAll("{output}", output.slice(0, 500))
    .replaceAll("{expected}", expected.slice(0, 500));
  const baseUrl = settings.llmBaseUrl || "https://api.openai.com/v1";
  const model = settings.llmModel || env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], temperature: 0.2 }),
    });
    if (!res.ok) return { status: "pending_llm", note: `LLM 调用失败（${res.status}）` };
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? "";
    const json = content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return { status: "pending_llm", note: "LLM 输出未按 JSON 返回" };
    const parsed = JSON.parse(json) as LlmJudgeResult["scores"] & { reason?: string };
    return { status: "scored", scores: parsed, reason: parsed.reason };
  } catch (error) {
    return { status: "pending_llm", note: `LLM 调用异常：${error instanceof Error ? error.message : String(error)}` };
  }
}

// ---------- Suite 1: rule_parse ----------
function runRuleParseSuite(): EvalSuiteResult {
  const cases: EvalCaseResult[] = RULE_PARSE_CASES.map((tc) => {
    const rule = parseSearchRuleHeuristic(tc.input);
    const problems: string[] = [];
    const followers = rule.hard_filters.followers;
    if (tc.expect.followers) {
      if (!followers || followers.operator !== tc.expect.followers.operator || followers.value !== tc.expect.followers.value) {
        problems.push(`followers 期望 ${tc.expect.followers.operator} ${tc.expect.followers.value}，实际 ${followers ? `${followers.operator} ${followers.value}` : "无"}`);
      }
    }
    const actualTerms = rule.semantic_conditions.flatMap((c) => c.terms);
    for (const term of tc.expect.semanticTerms ?? []) {
      if (!actualTerms.includes(term)) problems.push(`语义词缺 ${term}`);
    }
    if (tc.expect.rankingField && rule.ranking[0]?.field !== tc.expect.rankingField) problems.push(`排序期望 ${tc.expect.rankingField}，实际 ${rule.ranking[0]?.field ?? "无"}`);
    if (tc.expect.limit !== undefined && rule.limit !== tc.expect.limit) problems.push(`limit 期望 ${tc.expect.limit}，实际 ${rule.limit}`);
    if (tc.expect.ambiguities !== undefined && rule.ambiguities.length !== tc.expect.ambiguities) problems.push(`ambiguities 期望 ${tc.expect.ambiguities}，实际 ${rule.ambiguities.length}`);
    const expected = JSON.stringify(tc.expect);
    const actual = JSON.stringify({ followers, semanticTerms: actualTerms, ranking: rule.ranking[0]?.field, limit: rule.limit, ambiguities: rule.ambiguities.length });
    return { id: tc.id, pass: problems.length === 0, scoringMethod: "exact_match", input: tc.input, expected, actual, detail: problems.length ? problems.join("；") : "通过" };
  });
  return { id: "rule_parse", name: "自然语言检索规则解析（search-rules:parse 启发式 v1）· 评分：精准匹配", total: cases.length, passed: cases.filter((c) => c.pass).length, cases };
}

// ---------- Suite 2: audit_rules ----------
function runAuditRulesSuite(): EvalSuiteResult {
  const perRule = new Map<string, { tp: number; fp: number; fn: number }>();
  const cases: EvalCaseResult[] = AUDIT_RULE_CASES.map((tc) => {
    const matchedIds = AUDIT_RULES.filter((r) => r.pattern.test(tc.text)).map((r) => r.id);
    const expected = tc.expectRule;
    if (expected === "none") {
      const pass = matchedIds.length === 0;
      if (!pass) for (const id of matchedIds) bump(perRule, id, "fp");
      return { id: tc.id, pass, scoringMethod: "exact_match", input: tc.text, expected: "不命中任何规则", actual: matchedIds.length ? `命中 ${matchedIds.join(",")}` : "未命中", detail: pass ? "未命中任何规则（正确）" : `误报：命中 ${matchedIds.join(",")}` };
    }
    const hit = matchedIds.includes(expected);
    if (hit) {
      bump(perRule, expected, "tp");
      if (matchedIds.length > 1) for (const id of matchedIds.filter((x) => x !== expected)) bump(perRule, id, "fp");
      return { id: tc.id, pass: true, scoringMethod: "exact_match", input: tc.text, expected: `命中 ${expected}`, actual: `命中 ${matchedIds.join(",")}`, detail: `命中 ${expected}（同时命中 ${matchedIds.filter((x) => x !== expected).join(",") || "无"}）` };
    }
    bump(perRule, expected, "fn");
    for (const id of matchedIds) bump(perRule, id, "fp");
    return { id: tc.id, pass: false, scoringMethod: "exact_match", input: tc.text, expected: `命中 ${expected}`, actual: matchedIds.join(",") || "无", detail: `漏报：期望 ${expected}，实际命中 ${matchedIds.join(",") || "无"}` };
  });
  const metrics: Record<string, number | string> = {};
  for (const rule of AUDIT_RULES) {
    const m = perRule.get(rule.id) ?? { tp: 0, fp: 0, fn: 0 };
    const precision = m.tp + m.fp > 0 ? +(m.tp / (m.tp + m.fp)).toFixed(2) : 1;
    const recall = m.tp + m.fn > 0 ? +(m.tp / (m.tp + m.fn)).toFixed(2) : 1;
    metrics[`${rule.id}_precision`] = precision;
    metrics[`${rule.id}_recall`] = recall;
  }
  return { id: "audit_rules", name: "内容审核规则召回（广告法规则匹配 v1）· 评分：精准匹配", total: cases.length, passed: cases.filter((c) => c.pass).length, cases, metrics };
}
function bump(map: Map<string, { tp: number; fp: number; fn: number }>, id: string, field: "tp" | "fp" | "fn"): void {
  const m = map.get(id) ?? { tp: 0, fp: 0, fn: 0 };
  m[field] += 1;
  map.set(id, m);
}

// ---------- Suite 3: semantic_match（真实达人 + 多评分方法） ----------
async function runSemanticMatchSuite(settings: EvalSettings): Promise<EvalSuiteResult> {
  const env = loadEnv();
  const cases: EvalCaseResult[] = [];
  let loaded = 0;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: creators } = await client.from("creators").select("platform_creator_id, latest_snapshot").eq("platform", "xiaohongshu").limit(40);
    const profiles = (creators ?? [])
      .filter((c) => c.latest_snapshot)
      .map((c) => ({
        platformCreatorId: (c.platform_creator_id as string).slice(0, 4),
        corpus: `${((c.latest_snapshot as { bio?: string | null }).bio ?? "")} ${((c.latest_snapshot as { posts?: Array<{ title: string }> }).posts ?? []).map((p) => p.title).join(" ")}`,
        snapshot: c.latest_snapshot as unknown,
      }));
    loaded = profiles.length;

    for (const tc of SEMANTIC_MATCH_CASES) {
      const expectedText = tc.queryTerms.join(" / ");
      // 精准匹配（关键词基线）
      const keywordMatched = profiles.filter(({ corpus }) => tc.queryTerms.some((t) => corpus.includes(t))).map((p) => p.platformCreatorId);
      // 余弦相似度（bigram）：输入词 vs 每位达人语料
      const cosineHits = profiles
        .map((p) => ({ id: p.platformCreatorId, score: Math.max(...tc.queryTerms.map((t) => cosineSimilarity(t, p.corpus))) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      const cosineMatched = cosineHits.filter((h) => h.score > 0.1).map((h) => h.id);
      // 人工评估标注（回填判定）
      const annotations = await (await import("./storage.js")).loadAnnotations();
      const humanMatched = annotations.filter((a) => a.suite === "semantic_match" && a.status === "reviewed" && a.scores.overall >= 3).map((a) => a.id.split("-").pop());
      // LLM-as-judge：对首位候选做一次示例评分
      const sample = profiles[0];
      let llmDetail = "未配置 LLM";
      if (settings.llmBaseUrl || env.OPENAI_API_KEY) {
        const judge = await llmJudge(`查询词：${expectedText}；候选达人内容摘要：${sample ? sample.corpus.slice(0, 200) : "无"}\n请判断该达人是否匹配查询意图`, sample ? sample.corpus.slice(0, 300) : "无", `应命中查询词 ${expectedText}`);
        llmDetail = judge.status === "scored" ? `LLM 评分 overall=${judge.scores?.overall}（${judge.reason ?? ""}）` : judge.note ?? "pending";
      }
      // 未完成人工核验时进入 REVIEW，禁止基线套件无条件通过。
      const reviewed = annotations.filter((a) => a.suite === "semantic_match" && a.status === "reviewed");
      const rejected = annotations.filter((a) => a.suite === "semantic_match" && a.status === "rejected");
      const status: EvalCaseResult["status"] = reviewed.length > 0
        ? (reviewed.some((a) => a.scores.overall >= 3) ? "PASS" : "FAIL")
        : (rejected.length > 0 ? "FAIL" : "REVIEW");
      const pass = status === "PASS";
      cases.push({
        id: tc.id,
        pass,
        status,
        scoringMethod: "cosine_similarity",
        input: `查询：${expectedText}（真实库 ${loaded} 位达人）`,
        expected: `命中含 ${expectedText} 的达人（期望集待人工标注回填）`,
        actual: `关键词命中 ${keywordMatched.slice(0, 8).join(",") || "无"}；余弦 Top5 ${cosineHits.map((h) => `${h.id}:${h.score.toFixed(2)}`).join(",")}；人工标注命中 ${humanMatched.slice(0, 8).join(",") || "（未回填）"}；${llmDetail}`,
        detail: `${tc.note ?? ""}`,
      });
    }
  } catch (error) {
    cases.push({ id: "sm-00", pass: false, scoringMethod: "human_eval", input: "真实数据加载", expected: "正常加载", actual: "失败", detail: error instanceof Error ? error.message : String(error) });
  }
  return { id: "semantic_match", name: "达人语义匹配（真实库 · 评分：精准/余弦/LLM/人工）", total: cases.length, passed: cases.filter((c) => c.pass).length, cases };
}

export async function runAllEvals(): Promise<EvalSuiteResult[]> {
  const settings = loadSettings();
  return [runRuleParseSuite(), runAuditRulesSuite(), await runSemanticMatchSuite(settings)];
}
