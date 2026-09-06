// 本地 Eval 存储：JSON 文件持久化（标注/建议/设置），仅本地运行（D005）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function load<T>(file: string, fallback: T): T {
  const path = join(DATA_DIR, file);
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

function save(file: string, value: unknown): void {
  writeFileSync(join(DATA_DIR, file), JSON.stringify(value, null, 2), "utf8");
}

export interface Annotation {
  id: string;           // 用例 id（如 sm-01-{creatorId} 或 ar-01）
  caseId?: string;
  batchId?: string;
  reviewer?: string;
  suite: string;
  input: string;
  systemOutput: string;
  scores: { correctness: number; relevance: number; completeness: number; safety: number; tone: number; overall: number }; // 1-5
  status: "pending" | "reviewed" | "rejected";
  note: string;
  updatedAt: string;
}

export interface Suggestion {
  id: string;
  source: string;      // bad-case / manual
  title: string;
  detail: string;
  status: "open" | "done" | "wontfix";
  createdAt: string;
}

export interface ServiceRating {
  id: string;
  runId?: string;
  caseId?: string;
  score: number;
  comment?: string;
  input?: string;
  output?: string;
  createdAt: string;
}

export interface AbTestRecord {
  id: string;
  name: string;
  module?: string;
  baseline?: string;
  variant?: string;
  status: "draft" | "running" | "done";
  createdAt: string;
}
export interface EvalSettings {
  judgePrompt: string;
  llmBaseUrl: string;
  llmModel: string;
}

export interface EvalCaseDefinition {
  id: string;
  suite: string;
  name: string;
  input: string;
  expected: string;
  expectedBehavior: string[];
  expectedKeywords: { all?: string[]; any?: string[] };
  forbiddenWords: string[];
  riskLevel: "low" | "medium" | "high";
  dimensions: string[];
  enabled: boolean;
  source: "seed" | "manual" | "imported";
  updatedAt: string;
}

export type EvalStatus = "PASS" | "FAIL" | "REVIEW" | "ERROR";

export interface EvalBatchResult {
  id: string;
  batchId: string;
  caseId: string;
  suite: string;
  status: EvalStatus;
  pass: boolean;
  scoringMethod: string;
  input: string;
  expected: string;
  actual: string;
  evidence: string[];
  misses: string[];
  detail: string;
  durationMs: number;
  createdAt: string;
}

export interface EvalBatch {
  id: string;
  name: string;
  versionLabel: string;
  evaluatorVersion: string;
  caseIds: string[];
  caseSnapshot: EvalCaseDefinition[];
  caseSetHash: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  currentIndex: number;
  total: number;
  passed: number;
  failed: number;
  review: number;
  errors: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string;
  resultIds: string[];
}

export const DEFAULT_JUDGE_PROMPT = `你是内容审核与达人匹配的质量评审员。请对以下“系统输出 vs 期望结果”进行评分（1-5 分）：
维度：正确性、相关性、完整性、安全性、语气、整体质量。
只输出 JSON：{"correctness":n,"relevance":n,"completeness":n,"safety":n,"tone":n,"overall":n,"reason":"一句话理由"}
用例输入：{input}
系统输出：{output}
期望：{expected}`;

export function loadAnnotations(): Annotation[] { return load("annotations.json", []); }
export function saveAnnotations(annotations: Annotation[]): void { save("annotations.json", annotations); }
export function loadSuggestions(): Suggestion[] { return load("suggestions.json", []); }
export function saveSuggestions(suggestions: Suggestion[]): void { save("suggestions.json", suggestions); }export function loadRatings(): ServiceRating[] { return load("ratings.json", []); }
export function saveRatings(ratings: ServiceRating[]): void { save("ratings.json", ratings); }
export function loadAbTests(): AbTestRecord[] { return load("ab-tests.json", []); }
export function saveAbTests(tests: AbTestRecord[]): void { save("ab-tests.json", tests); }
export function loadSettings(): EvalSettings {
  return load("settings.json", { judgePrompt: DEFAULT_JUDGE_PROMPT, llmBaseUrl: "", llmModel: "" });
}
export function saveSettings(settings: EvalSettings): void { save("settings.json", settings); }

export function loadEvalCases(): EvalCaseDefinition[] { return load("eval_cases.json", []); }
export function saveEvalCases(cases: EvalCaseDefinition[]): void { save("eval_cases.json", cases); }
export function loadEvalBatches(): EvalBatch[] { return load("eval_batches.json", []); }
export function saveEvalBatches(batches: EvalBatch[]): void { save("eval_batches.json", batches); }
export function loadEvalBatchResults(): EvalBatchResult[] { return load("eval_results.json", []); }
export function saveEvalBatchResults(results: EvalBatchResult[]): void { save("eval_results.json", results); }
