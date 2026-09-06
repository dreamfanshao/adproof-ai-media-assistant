import { CREATOR_CANDIDATE_AGENT_PIPELINE } from "./capability-manifest.js";
import { getSkills, tools } from "./catalog.js";
import { model } from "./llm/model.js";
import { getModelConfig } from "./model-config.js";
import type { AgentPlan, PlanStep } from "./skills/types.js";

type EnabledCapabilities = { skills: string[]; tools: string[] };
const isEnabled = (step: PlanStep, enabled: EnabledCapabilities) =>
  step.capabilityType === "skill"
    ? enabled.skills.includes(step.capabilityId)
    : enabled.tools.includes(step.capabilityId);

const runtimeSteps = (hasImages: boolean, enabled: EnabledCapabilities): PlanStep[] =>
  CREATOR_CANDIDATE_AGENT_PIPELINE
    .filter((item) => hasImages || item.id !== "creator_image_understanding")
    .map((item, index) => ({
      id: "creator-step-" + (index + 1),
      capabilityType: item.capabilityType,
      capabilityId: item.id,
      purpose: item.purpose,
    }))
    .filter((item) => isEnabled(item, enabled));

const fallback = (hasImages: boolean, enabled: EnabledCapabilities): AgentPlan => ({
  planner: "deterministic-fallback",
  steps: runtimeSteps(hasImages, enabled),
  note: "模型不可用时使用生产候选判断能力清单，不伪造 Planner 结果。",
});

export async function plan(query: string, candidates: Array<{ imageUrls?: string[] }> = []): Promise<AgentPlan> {
  const enabled = {
    skills: getSkills().filter((item) => item.enabled).map((item) => item.id),
    tools: tools.filter((item) => item.enabled).map((item) => item.id),
  };
  const hasImages = candidates.some((item) => (item.imageUrls || []).length > 0);
  const requiredSteps = runtimeSteps(hasImages, enabled);
  const plannerModel = getModelConfig().planner;
  const result = await model({
    system: "你是达人候选判断 Planner。只能从提供的已启用能力中选择，不能删除个人账号识别、本人经历判断、语义匹配和确定性排序。返回 JSON：{steps:[{id,capabilityType,capabilityId,purpose}]}。",
    prompt: JSON.stringify({ query, availableCapabilities: requiredSteps, hasImages }),
    temperature: plannerModel.temperature,
    maxTokens: plannerModel.maxTokens,
  });
  const raw = result.data as { steps?: PlanStep[] } | undefined;
  if (!Array.isArray(raw?.steps) || !raw.steps.length) return fallback(hasImages, enabled);

  const selected = new Map(
    raw.steps
      .filter((item) => item?.capabilityId && (item.capabilityType === "skill" || item.capabilityType === "tool"))
      .filter((item) => isEnabled(item, enabled))
      .map((item) => [item.capabilityId, item]),
  );
  const steps = requiredSteps.map((required, index) => {
    const planned = selected.get(required.capabilityId);
    return {
      ...required,
      id: planned?.id || "creator-step-" + (index + 1),
      purpose: planned?.purpose || required.purpose,
    };
  });
  return { planner: "llm", steps, note: "Planner 输出已按生产能力白名单和必经能力校验。" };
}
