import { randomUUID } from "node:crypto";
import { getSkill, putRun } from "./catalog.js";
import { model, type ModelResult } from "./llm/model.js";
import { plan } from "./plan-agent.js";
import type { AgentPlan, AgentStepLog, CreatorAgentRun, CreatorCandidate } from "./skills/types.js";

const ts = () => new Date().toISOString();
const CREATOR_BATCH_TARGET = 20;
const DEFAULT_CREATOR_QUALITY_POLICY = {
  minimumOverallScore: 60,
  minimumSemanticConfidence: 0.62,
  requireEvidence: true,
} as const;

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeCreatorIntent(value: unknown): Record<string, unknown> {
  const parsed = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawPolicy = (parsed.qualityPolicy ?? parsed.quality_policy) as Record<string, unknown> | undefined;
  const suggestedScore = finiteNumber(rawPolicy?.minimumOverallScore ?? rawPolicy?.minimum_overall_score);
  const suggestedConfidence = finiteNumber(rawPolicy?.minimumSemanticConfidence ?? rawPolicy?.minimum_semantic_confidence);
  return {
    ...parsed,
    limit: CREATOR_BATCH_TARGET,
    qualityPolicy: {
      minimumOverallScore: clamp(suggestedScore ?? DEFAULT_CREATOR_QUALITY_POLICY.minimumOverallScore, 55, 70),
      minimumSemanticConfidence: clamp(suggestedConfidence ?? DEFAULT_CREATOR_QUALITY_POLICY.minimumSemanticConfidence, 0.55, 0.85),
      requireEvidence: DEFAULT_CREATOR_QUALITY_POLICY.requireEvidence,
      source: suggestedScore !== null || suggestedConfidence !== null ? "ai" : "default",
    },
  };
}
const semanticCapabilities = [
  "creator_personal_account_assessment",
  "creator_experience_evidence",
  "creator_semantic_matching",
] as const;
const log = (
  id: string,
  type: "skill" | "tool",
  input: unknown,
  output: unknown,
  status: "completed" | "pending_llm" | "error",
): AgentStepLog => ({
  id,
  capabilityType: type,
  capabilityId: id,
  startedAt: ts(),
  finishedAt: ts(),
  input,
  output,
  status,
});

const invoke = async (id: string, payload: unknown, images?: string[]): Promise<ModelResult> => {
  const skill = getSkill(id);
  const system = id === "creator_intent_structuring"
    ? [
        skill?.prompt ?? "",
        "额外返回 qualityPolicy：{minimumOverallScore,minimumSemanticConfidence,requireEvidence}。请根据需求的明确程度设定基本匹配底线；minimumOverallScore 取 55-70，minimumSemanticConfidence 取 0.55-0.85，有语义条件时 requireEvidence=true。limit 固定为 20。",
      ].join("\n\n")
    : skill?.prompt ?? "";
  return skill?.enabled
    ? model({ system, prompt: JSON.stringify(payload), images, temperature: skill.temperature })
    : { status: "error" as const, model: "none", note: "Skill 不存在或未启用：" + id };
};

const invokeSemanticAssessment = async (ids: string[], payload: unknown): Promise<ModelResult> => {
  const skills = ids.map((id) => getSkill(id)).filter((item) => item?.enabled);
  if (skills.length !== ids.length) {
    return { status: "error" as const, model: "none", note: "候选判断所需 Skill 未全部启用" };
  }
  const system = [
    ...skills.map((skill) => skill!.prompt),
    "质量底线：严格遵守语义条件中的 AND/OR/any 逻辑；any 条件命中任一分支即可，不得错误要求全部分支同时命中。evidence 必须列出候选内容中的具体事实，不能复述检索条件。只有泛科普、机构宣传或主题无关时必须 matched=false。粉丝数、点赞数、发帖数和时间窗口由代码判断，不得因这些数据字段缺失而判语义不匹配。",
    "只进行一次综合判断并返回一个 JSON 对象，必须包含 accountAssessment、experienceEvidence、matched、confidence、evidence、reasons。明确的机构、医院、门店或营销号不能当作个人博主；账号类型暂时 unknown 时，如果笔记有清楚的第一人称体验或本人皮肤困扰证据，允许 matched=true 并适当降低 confidence。没有本人经历证据时返回 unknown，不得猜测。",
  ].join("\n\n");
  return model({ system, prompt: JSON.stringify(payload), temperature: 0.1 });
};

const skillConcurrency = Math.min(8, Math.max(1, Number(process.env.AGENT_SKILL_CONCURRENCY ?? "4") || 4));
async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(skillConcurrency, items.length) }, () => consume()));
  return results;
}

export async function run(query: string, input: CreatorCandidate[] = [], given?: AgentPlan): Promise<CreatorAgentRun> {
  const selectedPlan = given || await plan(query, input);
  let candidates = [...input];
  const steps: AgentStepLog[] = [];
  let structured: Record<string, unknown> = { semanticConditions: [query], limit: CREATOR_BATCH_TARGET };
  let status: "scored" | "pending_llm" | "partial" = "scored";
  let summary: unknown = null;
  let semanticAssessmentCompleted = false;

  for (const planStep of selectedPlan.steps) {
    const id = planStep.capabilityId;
    if (id === "load_candidates") {
      steps.push(log(id, "tool", { count: candidates.length }, { count: candidates.length }, "completed"));
      continue;
    }
    if (id === "dedupe_candidates") {
      const seen = new Set<string>();
      const before = candidates.length;
      candidates = candidates.filter((candidate) => {
        const key = String(candidate.id || candidate.profileUrl || candidate.handle || candidate.nickname);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      steps.push(log(id, "tool", { before }, { after: candidates.length }, "completed"));
      continue;
    }
    if (id === "creator_intent_structuring") {
      const result = await invoke(id, { query });
      if (result.status === "scored" && result.data && typeof result.data === "object") structured = normalizeCreatorIntent(result.data);
      else status = "pending_llm";
      steps.push(log(id, "skill", { query }, result.data || result.note, result.status === "scored" ? "completed" : "pending_llm"));
      continue;
    }
    if (id === "creator_image_understanding") {
      const results = await mapWithConcurrency(candidates, async (candidate) => ({
        candidate,
        result: await invoke(id, { candidate, query }, (candidate.imageUrls || []).slice(0, 8)),
      }));
      const pending = results.some(({ result }) => result.status !== "scored");
      for (const { candidate, result } of results) candidate.imageEvidence = result.data || result.note;
      if (pending) status = "pending_llm";
      steps.push(log(id, "skill", { count: candidates.length }, candidates.map((candidate) => ({ id: candidate.id, imageEvidence: candidate.imageEvidence })), pending ? "pending_llm" : "completed"));
      continue;
    }
    if (semanticCapabilities.includes(id as typeof semanticCapabilities[number])) {
      if (semanticAssessmentCompleted) continue;
      semanticAssessmentCompleted = true;
      const selectedCapabilities = semanticCapabilities.filter((capabilityId) => selectedPlan.steps.some((step) => step.capabilityId === capabilityId));
      const results = await mapWithConcurrency(candidates, async (candidate) => ({
        candidate,
        result: await invokeSemanticAssessment([...selectedCapabilities], { query: structured, candidate, imageEvidence: candidate.imageEvidence }),
      }));
      const pending = results.some(({ result }) => result.status !== "scored");
      for (const { candidate, result } of results) {
        candidate.semanticMatch = result.data;
        candidate.matchScore = result.status === "scored"
          ? Math.round(Number((result.data as { confidence?: number } | undefined)?.confidence || 0) * 100)
          : 0;
      }
      if (pending) status = "pending_llm";
      for (const capabilityId of selectedCapabilities) {
        const outputKey = capabilityId === "creator_personal_account_assessment"
          ? "accountAssessment"
          : capabilityId === "creator_experience_evidence"
            ? "experienceEvidence"
            : null;
        const output = candidates.map((candidate) => {
          const semantic = candidate.semanticMatch as Record<string, unknown> | undefined;
          return { id: candidate.id, result: outputKey ? semantic?.[outputKey] : semantic };
        });
        steps.push(log(capabilityId, "skill", { count: candidates.length }, output, pending ? "pending_llm" : "completed"));
      }
      continue;
    }
    if (id === "rank_candidates") {
      candidates.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0) || (b.activity || 0) - (a.activity || 0));
      steps.push(log(id, "tool", {}, candidates.map((candidate) => candidate.id), "completed"));
      continue;
    }
    if (id === "persist_run") {
      steps.push(log(id, "tool", { count: candidates.length }, { recorded: true }, "completed"));
      continue;
    }
    if (id === "creator_evidence_summary") {
      const result = await invoke(id, { query: structured, candidates });
      summary = result.data || result.note;
      if (result.status !== "scored") status = "pending_llm";
      steps.push(log(id, "skill", { count: candidates.length }, summary, result.status === "scored" ? "completed" : "pending_llm"));
    }
  }

  const output = {
    id: randomUUID(),
    createdAt: ts(),
    query,
    plan: selectedPlan,
    steps,
    structuredQuery: structured,
    candidates: candidates.slice(0, CREATOR_BATCH_TARGET),
    summary,
    status,
    disclaimer: status === "scored" ? "LLM 结果仍需人工复核。" : "LLM 未完成，当前不代表 AI 结论。",
  } as CreatorAgentRun;
  return putRun(output);
}
