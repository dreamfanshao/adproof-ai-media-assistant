import { getSkill } from "./catalog.js";
import { model, type ModelResult } from "./llm/model.js";

export type AuditAgentFinding = {
  category?: string;
  riskLevel?: "high" | "medium" | "low" | "needs_confirmation";
  excerpt?: string;
  sourceChunkId?: string;
  sourceLocator?: string;
  explanation?: string;
  suggestion?: string;
  confidence?: number;
};
export type AuditAgentStep = { id: string; skillOrTool: string; status: string; input: unknown; output: unknown; startedAt: string; finishedAt: string; note?: string };
export type AuditAgentResult = {
  status: "scored" | "pending_llm" | "partial";
  plan: string[];
  steps: AuditAgentStep[];
  findings: AuditAgentFinding[];
  decision: { overallRisk: string; riskCounts?: Record<string, number>; recommendedAction?: string; rationale?: string; humanReviewItems?: string[] };
  disclaimer: string;
};

type AuditInput = {
  title: string;
  body: string;
  requirements?: string | null;
  knowledgeChunks: Array<{ id: string; content: string; source_locator?: string; knowledge_base_id?: string; document_id?: string; document_version?: number }>;
  deterministicFindings: AuditAgentFinding[];
  coverageWarnings: Array<{ code: string; message: string }>;
  assetUrls?: string[];
};
const now = () => new Date().toISOString();
const invoke = async (id: string, input: unknown, images?: string[]): Promise<ModelResult> => {
  const skill = getSkill(id);
  if (!skill || !skill.enabled) return { status: "error", model: "none", note: "审核 Skill 未启用：" + id };
  return model({ system: skill.prompt, prompt: JSON.stringify(input), images, temperature: skill.temperature });
};
const invokeMany = async (ids: string[], input: unknown, images?: string[]): Promise<ModelResult> => {
  const skills = ids.map((id) => getSkill(id)).filter((skill) => skill?.enabled);
  if (skills.length !== ids.length) return { status: "error", model: "none", note: "审核所需 Skill 未全部启用：" + ids.join(", ") };
  return model({
    system: [
      ...skills.map((skill) => skill!.prompt),
      "只进行一次模型调用并返回一个 JSON 对象，结果需要同时满足以上能力的输出契约。",
    ].join("\n\n"),
    prompt: JSON.stringify(input),
    images,
    temperature: Math.min(...skills.map((skill) => skill!.temperature)),
  });
};
const outputOf = (result: ModelResult) => result.data ?? { status: result.status, note: result.note };

export async function runContentAuditAgent(input: AuditInput): Promise<AuditAgentResult> {
  const steps: AuditAgentStep[] = [];
  const plan = [
    "audit_retrieve_knowledge", "audit_deterministic_rule_scan", "audit_knowledge_coverage",
    "audit_intent_structuring", "audit_claim_extraction", "audit_image_understanding",
    "audit_text_compliance", "audit_evidence_grounding", "audit_risk_decision",
    "audit_risk_floor", "audit_rewrite_guidance", "audit_review_summary", "audit_persist_findings",
  ];
  let status: AuditAgentResult["status"] = "scored";
  const record = (id: string, skillOrTool: string, value: ModelResult | unknown, stepInput: unknown) => {
    const isModel = typeof value === "object" && value !== null && "status" in value;
    const modelValue = isModel ? value as ModelResult : null;
    const stepStatus = modelValue?.status === "scored" ? "completed" : modelValue ? "pending_llm" : "completed";
    if (modelValue && modelValue.status !== "scored") status = "pending_llm";
    steps.push({ id, skillOrTool, status: stepStatus, input: stepInput, output: modelValue ? outputOf(modelValue) : value, startedAt: now(), finishedAt: now(), note: modelValue?.note });
  };
  record("audit_retrieve_knowledge", "tool", { chunks: input.knowledgeChunks.length }, { count: input.knowledgeChunks.length });
  record("audit_deterministic_rule_scan", "tool", { findings: input.deterministicFindings.length }, { count: input.deterministicFindings.length });
  record("audit_knowledge_coverage", "audit_knowledge_coverage", {
    status: input.knowledgeChunks.length && !input.coverageWarnings.length ? "covered" : "limited",
    chunks: input.knowledgeChunks.length,
    warnings: input.coverageWarnings,
  }, { chunks: input.knowledgeChunks.length, warnings: input.coverageWarnings.length });

  const intent = await invokeMany(["audit_intent_structuring", "audit_claim_extraction"], { title: input.title, body: input.body, requirements: input.requirements });
  record("audit_intent_structuring", "audit_intent_structuring", intent, { title: input.title, requirements: input.requirements });
  record("audit_claim_extraction", "audit_claim_extraction", intent.status === "scored" ? { claims: (intent.data as { claims?: unknown } | undefined)?.claims ?? [] } : intent, { title: input.title, bodyLength: input.body.length });
  const image = input.assetUrls?.length
    ? await invoke("audit_image_understanding", { contentContext: { title: input.title, body: input.body }, knowledgeChunks: input.knowledgeChunks.slice(0, 20) }, input.assetUrls)
    : { status: "scored" as const, model: "none", data: { status: "no_assets" } };
  record("audit_image_understanding", "audit_image_understanding", image, { assets: input.assetUrls?.length || 0 });
  const text = await invoke("audit_text_compliance", {
    content: { title: input.title, body: input.body },
    requirements: input.requirements,
    intent: intent.data,
    knowledgeChunks: input.knowledgeChunks.slice(0, 40),
    deterministicFindings: input.deterministicFindings,
    imageEvidence: image.data,
  });
  record("audit_text_compliance", "audit_text_compliance", text, { chunks: input.knowledgeChunks.length, deterministicFindings: input.deterministicFindings.length });
  const textData = (text.data && typeof text.data === "object") ? text.data as { findings?: AuditAgentFinding[] } : {};
  const findings = [...input.deterministicFindings, ...(Array.isArray(textData.findings) ? textData.findings : [])].slice(0, 100);
  record("audit_evidence_grounding", "audit_evidence_grounding", {
    grounded: findings.filter((finding) => finding.sourceChunkId || finding.sourceLocator).length,
    unresolved: findings.filter((finding) => !finding.sourceChunkId && !finding.sourceLocator).length,
  }, { findings: findings.length, chunks: input.knowledgeChunks.length });
  const fallbackRisk = findings.some((f) => f.riskLevel === "high") ? "high" : findings.some((f) => f.riskLevel === "medium") ? "medium" : input.coverageWarnings.length ? "needs_confirmation" : "low";
  const decision = await invoke("audit_risk_decision", { findings, coverageWarnings: input.coverageWarnings, knowledgeSnapshot: input.knowledgeChunks.map((c) => ({ id: c.id, source_locator: c.source_locator })), requirements: input.requirements, imageEvidence: image.data });
  record("audit_risk_decision", "audit_risk_decision", decision, { findings: findings.length, warnings: input.coverageWarnings.length });
  const decisionData: AuditAgentResult["decision"] = decision.data && typeof decision.data === "object" ? decision.data as AuditAgentResult["decision"] : { overallRisk: fallbackRisk };
  const proposedRisk = decision.status === "scored" && ["high", "medium", "needs_confirmation", "low"].includes(String(decisionData.overallRisk))
    ? String(decisionData.overallRisk)
    : fallbackRisk;
  const riskOrder: Record<string, number> = { high: 3, medium: 2, needs_confirmation: 2, low: 1 };
  const finalRisk = (riskOrder[proposedRisk] ?? 0) >= (riskOrder[fallbackRisk] ?? 0) ? proposedRisk : fallbackRisk;
  const finalDecision = { overallRisk: finalRisk, riskCounts: decisionData.riskCounts, recommendedAction: decisionData.recommendedAction || (finalRisk === "high" ? "修改后重新审核" : "人工复核后决定"), rationale: decisionData.rationale, humanReviewItems: decisionData.humanReviewItems };
  record("audit_risk_floor", "audit_risk_floor", { proposedRisk, fallbackRisk, finalRisk, protected: finalRisk !== proposedRisk }, { findings: findings.length, warnings: input.coverageWarnings.length });
  const summary = await invokeMany(["audit_rewrite_guidance", "audit_review_summary"], { findings, decision: finalDecision, originalContent: { title: input.title, body: input.body } });
  record("audit_rewrite_guidance", "audit_rewrite_guidance", summary.status === "scored" ? { rewriteGuidance: (summary.data as { rewriteGuidance?: unknown } | undefined)?.rewriteGuidance ?? [] } : summary, { findings: findings.length });
  record("audit_review_summary", "audit_review_summary", summary, { findings: findings.length });
  record("audit_persist_findings", "tool", { findings: findings.length, status }, { findings: findings.length });
  return { status, plan, steps, findings, decision: finalDecision, disclaimer: status === "scored" ? "审核结果由规则证据与 LLM 语义分析共同生成，不能替代法律意见，仍需人工复核。" : "LLM 未完整执行，当前结果不能视为最终审核结论。" };
}
