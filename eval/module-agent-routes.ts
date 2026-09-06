import type { FastifyInstance } from "fastify";
import { getRuns } from "../agent/catalog.js";
import { run as runCreatorAgent } from "../agent/run-agent.js";
import { runContentAuditAgent } from "../agent/content-audit-agent.js";
import { AUDIT_RULES } from "../server/src/services/audit-rules.js";
import type { ProductModule } from "./module-types.js";

function moduleOf(value: string): ProductModule | null { return value === "creators" || value === "audit" ? value : null; }

export function registerModuleAgentRoutes(app: FastifyInstance): void {
  app.post("/api/module-agent/:module/run", async (request, reply) => {
    const module = moduleOf((request.params as { module: string }).module);
    if (!module) return reply.code(404).send({ data: { error: "业务模块不存在" } });
    const body = (request.body ?? {}) as { question?: string; title?: string; body?: string; requirements?: string; assetUrls?: string[] };
    const question = String(body.question ?? body.body ?? "").trim();
    if (!question) return reply.code(400).send({ data: { error: "question 不能为空" } });
    const started = Date.now();
    try {
      if (module === "creators") {
        const sourceRun = getRuns().find((run) => run.candidates.some((candidate) => candidate.source === "redfox"));
        const candidates = sourceRun?.candidates.filter((candidate) => candidate.source === "redfox").slice(0, 20) ?? [];
        if (!candidates.length) {
          return reply.code(409).send({ data: { error: "暂无真实 RedFox Agent 候选记录。请先在业务系统完成一次达人检索，再使用 Agent 控制台。" } });
        }
        const result = await runCreatorAgent(question, candidates);
        return { data: { module, question, dataSource: "stored-redfox-agent-run", sourceRunId: sourceRun!.id, candidateCount: candidates.length, runId: result.id, status: result.status, provider: process.env.LLM_PROVIDER ?? process.env.MODEL_PROVIDER ?? "openai-compatible", model: process.env.LLM_MODEL ?? "skill-configured", plan: result.steps.map((step) => ({ id: step.id, capabilityId: step.capabilityId, status: step.status })), steps: result.steps, finalReply: result.summary, risk: { status: "REVIEW", note: "达人检索结果仍需人工确认" }, durationMs: Date.now() - started } };
      }
      const text = String(body.body ?? question);
      const matchedRules = AUDIT_RULES.filter((rule) => rule.pattern.test(text));
      const deterministicFindings = matchedRules.map((rule) => ({ category: rule.category, riskLevel: rule.riskLevel, excerpt: text, sourceChunkId: `law-${rule.id}`, sourceLocator: rule.lawRef, explanation: `命中规则 ${rule.id}`, suggestion: rule.suggestion, confidence: rule.confidence }));
      const result = await runContentAuditAgent({ title: body.title ?? "控制台审核任务", body: text, requirements: body.requirements ?? "依据广告法和当前知识库审核", knowledgeChunks: matchedRules.map((rule) => ({ id: `law-${rule.id}`, content: rule.lawExcerpt, source_locator: rule.lawRef, knowledge_base_id: "public-law", document_id: "advertising-law", document_version: 1 })), deterministicFindings, coverageWarnings: [], assetUrls: body.assetUrls ?? [] });
      return { data: { module, question, runId: `audit-console-${Date.now()}`, status: result.status, provider: process.env.LLM_PROVIDER ?? process.env.MODEL_PROVIDER ?? "openai-compatible", model: process.env.LLM_MODEL ?? "skill-configured", plan: result.steps.map((step) => ({ id: step.id, capabilityId: step.id, status: step.status })), steps: result.steps, finalReply: JSON.stringify({ decision: result.decision, findings: result.findings, disclaimer: result.disclaimer }, null, 2), risk: { status: result.decision.overallRisk, note: result.disclaimer }, durationMs: Date.now() - started } };
    } catch (error) {
      return reply.code(500).send({ data: { error: error instanceof Error ? error.message : String(error), module, durationMs: Date.now() - started } });
    }
  });
}
