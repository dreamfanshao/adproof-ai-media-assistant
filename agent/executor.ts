import { randomUUID } from "node:crypto";
import { callJsonModel, type ModelResult } from "./llm/openai-compatible.js";
import { createCreatorPlan } from "./planner.js";
import { loadAgentRuns, saveAgentRuns } from "./storage.js";
import { getSkill } from "./skills/registry.js";
import type { AgentPlan, AgentStepLog, CreatorAgentRun, CreatorCandidate } from "./skills/types.js";

type QueryShape = { hardFilters?: Record<string, unknown>; semanticConditions?: string[]; limit?: number; ranking?: string[] };

function now() { return new Date().toISOString(); }
function json(value: unknown) { return JSON.parse(JSON.stringify(value ?? null)); }

function dedupe(candidates: CreatorCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = String(candidate.id || candidate.profileUrl || candidate.handle || candidate.nickname).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rank(candidates: CreatorCandidate[]) {
  return [...candidates].sort((a, b) => (Number(b.matchScore || 0) - Number(a.matchScore || 0)) || (Number(b.activity || 0) - Number(a.activity || 0)) || (Number(a.followers || 0) - Number(b.followers || 0)));
}

async function invokeSkill(id: string, input: unknown, images?: Array<{ url: string }>): Promise<ModelResult> {
  const skill = getSkill(id);
  if (!skill || !skill.enabled) return { status: "error", model: "none", note: "Skill 未启用或不存在：" + id };
  return callJsonModel({ system: skill.prompt, prompt: JSON.stringify(input), images, temperature: skill.temperature });
}

function step(id: string, type: "skill" | "tool", input: unknown, output: unknown, status: AgentStepLog["status"], note?: string): AgentStepLog {
  return { id, capabilityType: type, capabilityId: id, startedAt: now(), finishedAt: now(), status, input: json(input), output: json(output), note } as AgentStepLog;
}

export async function runCreatorAgent(input: { query: string; candidates?: CreatorCandidate[]; plan?: AgentPlan }): Promise<CreatorAgentRun> {
  const candidates = input.candidates || [];
  const plan = input.plan || await createCreatorPlan(input.query, candidates);
  const logs: AgentStepLog[] = [];
  let current = candidates;
  let structuredQuery: QueryShape = { semanticConditions: [input.query], limit: 50 };
  let llmStatus: "scored" | "pending_llm" | "partial" = "scored";
  let summary: unknown = null;

  for (const planned of plan.steps) {
    const id = planned.capabilityId;
    if (id === "load_candidates") {
      logs.push(step(id, "tool", { count: current.length }, { count: current.length }, "completed"));
      continue;
    }
    if (id === "dedupe_candidates") {
      const before = current.length;
      current = dedupe(current);
      logs.push(step(id, "tool", { before }, { after: current.length }, "completed"));
      continue;
    }
    if (id === "rank_candidates") {
      current = rank(current);
      logs.push(step(id, "tool", { count: current.length }, { count: current.length, ordering: "matchScore/activity/followers" }, "completed"));
      continue;
    }
    if (id === "persist_run") continue;

    if (id === "creator_intent_structuring") {
      const result = await invokeSkill(id, { query: input.query });
      if (result.status === "scored" && result.data && typeof result.data === "object") structuredQuery = result.data as QueryShape;
      else llmStatus = "pending_llm";
      logs.push(step(id, "skill", { query: input.query }, result.data || { status: result.status, note: result.note }, result.status === "scored" ? "completed" : "pending_llm", result.note));
      continue;
    }
    if (id === "creator_image_understanding") {
      const output: Record<string, unknown> = {};
      let pending = false;
      for (const candidate of current) {
        const urls = (candidate.imageUrls || []).slice(0, 8).map((url) => ({ url }));
        if (!urls.length) { output[candidate.id] = { status: "no_images" }; continue; }
        const result = await invokeSkill(id, { candidate: { id: candidate.id, nickname: candidate.nickname, bio: candidate.bio, posts: candidate.posts }, instruction: "只返回与检索条件相关的可核验证据，不猜测图片中看不清的内容。" }, urls);
        output[candidate.id] = result.data || { status: result.status, note: result.note };
        if (result.status !== "scored") pending = true;
        if (result.status === "scored") candidate.imageEvidence = result.data;
      }
      if (pending) llmStatus = "pending_llm";
      logs.push(step(id, "skill", { count: current.length }, output, pending ? "pending_llm" : "completed"));
      continue;
    }
    if (id === "creator_semantic_matching") {
      let pending = false;
      const output: Record<string, unknown> = {};
      for (const candidate of current) {
        const result = await invokeSkill(id, { query: structuredQuery, candidate: { id: candidate.id, nickname: candidate.nickname, handle: candidate.handle, bio: candidate.bio, followers: candidate.followers, activity: candidate.activity, posts: candidate.posts, imageEvidence: candidate.imageEvidence }, instruction: "按语义匹配条件逐项判断，返回 {matched, confidence, evidence, reasons}，不要输出最终总分。" });
        output[candidate.id] = result.data || { status: result.status, note: result.note };
        if (result.status !== "scored") { pending = true; continue; }
        candidate.semanticMatch = result.data;
        candidate.matchScore = Math.round(Math.max(0, Math.min(100, Number((result.data as { confidence?: number }).confidence || 0) * 100)));
      }
      if (pending) llmStatus = "pending_llm";
      logs.push(step(id, "skill", { query: structuredQuery, count: current.length }, output, pending ? "pending_llm" : "completed"));
      continue;
    }
    if (id === "creator_evidence_summary") {
      const result = await invokeSkill(id, { query: structuredQuery, candidates: current.map((candidate) => ({ id: candidate.id, nickname: candidate.nickname, semanticMatch: candidate.semanticMatch, imageEvidence: candidate.imageEvidence })) });
      summary = result.data || { status: result.status, note: result.note };
      if (result.status !== "scored") llmStatus = "pending_llm";
      logs.push(step(id, "skill", { count: current.length }, summary, result.status === "scored" ? "completed" : "pending_llm", result.note));
    }
  }

  current = rank(current);
  const run = {
    id: randomUUID(), createdAt: now(), query: input.query, plan, steps: logs,
    structuredQuery, candidates: current.slice(0, Number(structuredQuery.limit || 50)),
    summary, status: llmStatus, disclaimer: llmStatus === "scored" ? "结果含 LLM 语义与图片证据，请人工复核。" : "当前未完成 LLM 评分；页面结果仅展示采集数据或部分步骤，不能视为 AI 结论。",
  } as CreatorAgentRun;
  const runs = loadAgentRuns();
  saveAgentRuns([run, ...runs].slice(0, 100));
  return run;
}
