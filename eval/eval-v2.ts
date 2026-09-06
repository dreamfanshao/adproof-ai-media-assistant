import { createHash, randomUUID } from "node:crypto";
import { AUDIT_RULE_CASES, RULE_PARSE_CASES, SEMANTIC_MATCH_CASES } from "./datasets.js";
import {
  loadEvalCases, saveEvalCases, loadEvalBatches, saveEvalBatches, loadEvalBatchResults,
  saveEvalBatchResults, type EvalBatch, type EvalBatchResult, type EvalCaseDefinition, type EvalStatus,
} from "./storage.js";

export const EVALUATOR_VERSION = "adproof-eval-snackops-v1";

function now() { return new Date().toISOString(); }
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }

export function seedEvalCases(): EvalCaseDefinition[] {
  const existing = loadEvalCases();
  if (existing.length) return existing;
  const createdAt = now();
  const cases: EvalCaseDefinition[] = [
    ...RULE_PARSE_CASES.map((item) => ({
      id: item.id, suite: "rule_parse", name: item.id, input: item.input,
      expected: JSON.stringify(item.expect), expectedBehavior: ["正确提取硬过滤、语义条件、排序和返回数量"],
      expectedKeywords: { all: item.expect.semanticTerms }, forbiddenWords: [], riskLevel: "low" as const,
      dimensions: ["correctness", "completeness"], enabled: true, source: "seed" as const, updatedAt: createdAt,
    })),
    ...AUDIT_RULE_CASES.map((item) => ({
      id: item.id, suite: "audit_rules", name: item.id, input: item.text,
      expected: item.expectRule, expectedBehavior: [item.expectRule === "none" ? "不应命中任何规则" : `应命中规则 ${item.expectRule}`],
      expectedKeywords: { all: item.expectRule === "none" ? [] : [item.expectRule] }, forbiddenWords: [],
      riskLevel: item.expectRule === "none" ? "low" as const : "high" as const,
      dimensions: ["correctness", "safety"], enabled: true, source: "seed" as const, updatedAt: createdAt,
    })),
    ...SEMANTIC_MATCH_CASES.map((item) => ({
      id: item.id, suite: "semantic_match", name: item.id, input: item.queryTerms.join("、"),
      expected: `${item.match}：${item.queryTerms.join("、")}`, expectedBehavior: ["检索结果需有证据支撑，无法仅凭关键词时进入人工复核"],
      expectedKeywords: item.match === "all" ? { all: item.queryTerms } : { any: item.queryTerms }, forbiddenWords: [],
      riskLevel: "medium" as const, dimensions: ["correctness", "relevance", "completeness"], enabled: true,
      source: "seed" as const, updatedAt: createdAt,
    })),
  ];
  saveEvalCases(cases);
  return cases;
}

export function listEvalCases(options?: { suite?: string; enabledOnly?: boolean }): EvalCaseDefinition[] {
  const cases = seedEvalCases();
  return cases.filter((item) => (!options?.suite || item.suite === options.suite) && (!options?.enabledOnly || item.enabled));
}

export function upsertEvalCase(input: Partial<EvalCaseDefinition> & Pick<EvalCaseDefinition, "id" | "suite" | "name" | "input" | "expected">): EvalCaseDefinition {
  const cases = seedEvalCases();
  const item: EvalCaseDefinition = {
    id: input.id, suite: input.suite, name: input.name, input: input.input, expected: input.expected,
    expectedBehavior: input.expectedBehavior ?? [], expectedKeywords: input.expectedKeywords ?? {}, forbiddenWords: input.forbiddenWords ?? [],
    riskLevel: input.riskLevel ?? "low", dimensions: input.dimensions ?? ["correctness"], enabled: input.enabled ?? true,
    source: input.source ?? "manual", updatedAt: now(),
  };
  const index = cases.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) cases[index] = item; else cases.push(item);
  saveEvalCases(cases);
  return item;
}

export function deleteEvalCase(id: string): boolean {
  const current = seedEvalCases();
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  saveEvalCases(next);
  return true;
}

export function summarizeStatuses(results: Array<{ status: EvalStatus }>) {
  return {
    passed: results.filter((item) => item.status === "PASS").length,
    failed: results.filter((item) => item.status === "FAIL").length,
    review: results.filter((item) => item.status === "REVIEW").length,
    errors: results.filter((item) => item.status === "ERROR").length,
  };
}

export function qualityPassRate(summary: ReturnType<typeof summarizeStatuses>): number | null {
  const denominator = summary.passed + summary.failed + summary.review;
  return denominator ? Math.round((summary.passed / denominator) * 1000) / 10 : null;
}

export function createEvalBatch(input?: { name?: string; versionLabel?: string; caseIds?: string[] }): EvalBatch {
  const cases = listEvalCases({ enabledOnly: true });
  const selected = input?.caseIds?.length ? input.caseIds.map((id) => cases.find((item) => item.id === id)).filter(Boolean) as EvalCaseDefinition[] : cases;
  if (!selected.length) throw new Error("没有可运行的 EvalCase");
  const batch: EvalBatch = {
    id: `EB-${randomUUID().slice(0, 8)}`, name: input?.name ?? "本地回归评测", versionLabel: input?.versionLabel ?? "workspace",
    evaluatorVersion: EVALUATOR_VERSION, caseIds: selected.map((item) => item.id), caseSnapshot: selected,
    caseSetHash: hash(selected), status: "queued", currentIndex: 0, total: selected.length,
    passed: 0, failed: 0, review: 0, errors: 0, createdAt: now(), startedAt: null, finishedAt: null, resultIds: [],
  };
  saveEvalBatches([batch, ...loadEvalBatches()]);
  return batch;
}

export function getEvalBatch(id: string): EvalBatch | undefined { return loadEvalBatches().find((item) => item.id === id); }
export function listEvalBatches(): EvalBatch[] { return loadEvalBatches().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)); }

export function updateEvalBatch(id: string, update: (batch: EvalBatch) => EvalBatch): EvalBatch {
  const batches = loadEvalBatches();
  const index = batches.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`评测批次不存在: ${id}`);
  batches[index] = update(batches[index]);
  saveEvalBatches(batches);
  return batches[index];
}

export function appendEvalBatchResult(result: EvalBatchResult): void {
  saveEvalBatchResults([result, ...loadEvalBatchResults().filter((item) => item.id !== result.id)]);
}

export function getEvalBatchResults(batchId: string): EvalBatchResult[] {
  return loadEvalBatchResults().filter((item) => item.batchId === batchId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
