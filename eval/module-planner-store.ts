import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultMandatorySkills, defaultToolGroups } from "../agent/capability-manifest.js";
import { getSkills, tools } from "../agent/catalog.js";
import { getModelConfig, saveModelConfig } from "../agent/model-config.js";
import type { ProductModule } from "./module-types.js";

export interface ModulePlannerConfig {
  module: ProductModule;
  systemPrompt: string;
  mandatorySkills: string[];
  toolGroups: Record<string, string[]>;
  model: { provider: string; model: string; temperature: number; maxTokens: number };
  updatedAt: string;
}

const filePath = join(process.cwd(), "eval", "data", "module_planner_config.json");
const defaultPrompt = (module: ProductModule) => module === "creators"
  ? "你是媒介助手达人检索 Planner。执行顺序必须与生产 Worker 一致：结构化条件与搜索策略 → 读取持久化游标和筛选历史 → RedFox 分页召回 → 账号详情与硬条件筛选 → 代表笔记和可选图片证据 → 个人博主识别、本人经历判断与语义匹配 → 确定性排序和证据落库 → 20 人批次续检判断。只能调用当前启用的 Skill 和 Tool；不得使用静态候选冒充真实 RedFox 数据，不得突破安全调用预算。"
  : "你是媒介助手内容审核 Planner。执行顺序必须与生产 Worker 一致：知识库与确定性规则 → 覆盖评估和声明提取 → 可选图片理解 → 文本合规与证据绑定 → 风险决策和确定性风险下限 → 改写建议与人工复核 → findings、知识快照和覆盖警告落库。只能调用当前启用的 Skill 和 Tool；不得虚构法条或把辅助审核表述为法律意见。";

const corruptPattern = /\?{3,}|[銆锛鏁浜鎰璇绾妫鍛鏈閫鎵鐢娴绉缁]/;
export function looksCorruptPlannerText(value: unknown): boolean {
  return typeof value !== "string" || !value.trim() || corruptPattern.test(value);
}

function runtimeModel() {
  const config = getModelConfig();
  return { provider: config.text.provider, model: config.text.model };
}

function moduleSkillIds(module: ProductModule): Set<string> {
  const prefix = module === "creators" ? "creator_" : "audit_";
  return new Set(getSkills().filter((item) => item.id.startsWith(prefix)).map((item) => item.id));
}

function moduleToolIds(module: ProductModule): Set<string> {
  return new Set(tools.filter((item) => module === "creators" ? !item.id.startsWith("audit_") : item.id.startsWith("audit_")).map((item) => item.id));
}

function defaults(module: ProductModule): ModulePlannerConfig {
  const runtime = getModelConfig();
  const model = runtimeModel();
  return {
    module,
    systemPrompt: defaultPrompt(module),
    mandatorySkills: defaultMandatorySkills(module),
    toolGroups: defaultToolGroups(module),
    model: module === "creators"
      ? { ...model, ...runtime.planner }
      : { ...model, temperature: 0, maxTokens: 0 },
    updatedAt: new Date().toISOString(),
  };
}

function normalizeConfig(module: ProductModule, value: Partial<ModulePlannerConfig> | undefined): ModulePlannerConfig {
  const fallback = defaults(module);
  const skillIds = moduleSkillIds(module);
  const toolIds = moduleToolIds(module);
  const mandatorySkills = defaultMandatorySkills(module).filter((id) => skillIds.has(id));
  const inputGroups = value?.toolGroups && typeof value.toolGroups === "object" ? value.toolGroups : {};
  const normalizedGroups = Object.fromEntries(
    Object.entries(inputGroups)
      .filter(([name, ids]) => !looksCorruptPlannerText(name) && Array.isArray(ids))
      .map(([name, ids]) => [name, ids.filter((id) => toolIds.has(id))])
      .filter(([, ids]) => ids.length),
  );
  const runtime = runtimeModel();
  return {
    module,
    systemPrompt: looksCorruptPlannerText(value?.systemPrompt) ? fallback.systemPrompt : value!.systemPrompt!.trim(),
    mandatorySkills: mandatorySkills.length ? mandatorySkills : fallback.mandatorySkills,
    toolGroups: Object.keys(normalizedGroups).length ? normalizedGroups : fallback.toolGroups,
    model: {
      provider: runtime.provider,
      model: runtime.model,
      temperature: fallback.model.temperature,
      maxTokens: fallback.model.maxTokens,
    },
    updatedAt: value?.updatedAt || fallback.updatedAt,
  };
}

function readAll(): Partial<Record<ProductModule, ModulePlannerConfig>> {
  if (!existsSync(filePath)) return {};
  try { return JSON.parse(readFileSync(filePath, "utf8")) as Partial<Record<ProductModule, ModulePlannerConfig>>; } catch { return {}; }
}

function writeAll(data: Partial<Record<ProductModule, ModulePlannerConfig>>): void {
  mkdirSync(join(process.cwd(), "eval", "data"), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, filePath);
}

export function getPlannerConfig(module: ProductModule): ModulePlannerConfig {
  const all = readAll();
  const current = all[module];
  const { data: _nested, ...cleanCurrent } = (current ?? {}) as ModulePlannerConfig & { data?: unknown };
  const normalized = normalizeConfig(module, cleanCurrent);
  if (JSON.stringify(current) !== JSON.stringify(normalized)) {
    all[module] = { ...normalized, updatedAt: new Date().toISOString() };
    writeAll(all);
    return all[module]!;
  }
  return normalized;
}

export function savePlannerConfig(module: ProductModule, patch: Partial<ModulePlannerConfig>): ModulePlannerConfig {
  const normalized = (patch as { data?: Partial<ModulePlannerConfig> })?.data ?? patch;
  if (normalized.systemPrompt !== undefined && looksCorruptPlannerText(normalized.systemPrompt)) throw new Error("Planner System Prompt 为空或包含乱码");
  if (module === "creators" && normalized.model) {
    saveModelConfig({
      planner: {
        temperature: Math.max(0, Math.min(2, Number(normalized.model.temperature) || 0)),
        maxTokens: Math.max(200, Math.min(16_000, Number(normalized.model.maxTokens) || 1800)),
      },
    });
  }
  const next = normalizeConfig(module, { ...getPlannerConfig(module), ...normalized, updatedAt: new Date().toISOString() });
  const data = readAll();
  data[module] = next;
  writeAll(data);
  return next;
}
