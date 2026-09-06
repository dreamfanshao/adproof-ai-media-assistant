import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRuns, getSkills, patchSkill, tools } from "../agent/catalog.js";
import type { SkillDefinition } from "../agent/skills/types.js";
import { loadModuleBatches, loadModuleCases, loadModuleRuns } from "./module-store.js";
import type { ProductModule } from "./module-types.js";
import { getModelConfig } from "../agent/model-config.js";

function modelRuntime() {
  const config = getModelConfig();
  const ready = Boolean(process.env[config.text.apiKeyEnv]);
  return { provider: ready ? config.text.provider : `${config.text.provider}-unconfigured`, model: config.text.model, visionModel: config.vision.model };
}

type SkillVersion = {
  id: string;
  skillId: string;
  module: ProductModule;
  version: number;
  snapshot: SkillDefinition;
  changeNote: string;
  hash: string;
  createdAt: string;
};

const versionPath = join(process.cwd(), "agent", "data", "skill-versions.json");

function loadVersions(): SkillVersion[] {
  if (!existsSync(versionPath)) return [];
  try { return JSON.parse(readFileSync(versionPath, "utf8")) as SkillVersion[]; } catch { return []; }
}

function saveVersions(rows: SkillVersion[]): void {
  mkdirSync(join(process.cwd(), "agent", "data"), { recursive: true });
  const temp = `${versionPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(rows, null, 2), "utf8");
  renameSync(temp, versionPath);
}

function prefix(module: ProductModule): string { return module === "creators" ? "creator_" : "audit_"; }

export function moduleAdminOverview(module: ProductModule) {
  const skillRows = getSkills().filter((item) => item.id.startsWith(prefix(module)));
  const toolRows = tools.filter((item) => module === "creators" ? !item.id.startsWith("audit_") : item.id.startsWith("audit_"));
  const cases = loadModuleCases(module);
  const batches = loadModuleBatches(module);
  const moduleRuns = loadModuleRuns(module);
  const agentRuns = module === "creators" ? getRuns().slice(0, 20) : [];
  const config = getModelConfig();
  const configured = Boolean(process.env[config.text.apiKeyEnv]);
  return {
    module,
    skills: skillRows,
    tools: toolRows,
    versions: loadVersions().filter((item) => item.module === module),
    metrics: { skills: skillRows.length, enabledSkills: skillRows.filter((item) => item.enabled).length, tools: toolRows.length, enabledTools: toolRows.filter((item) => item.enabled).length, evalCases: cases.length, evalBatches: batches.length, evalRuns: moduleRuns.length, agentRuns: agentRuns.length },
    provider: { id: configured ? config.text.provider : `${config.text.provider}-unconfigured`, model: config.text.model, configured, note: configured ? "真实模型配置已加载" : "未配置模型密钥；Agent 将返回 pending_llm，不会伪装成功。" },
  };
}

export function updateModuleSkill(module: ProductModule, id: string, patch: Partial<SkillDefinition>, changeNote: string) {
  if (!id.startsWith(prefix(module))) throw new Error("Skill 不属于当前模块");
  const current = getSkills().find((item) => item.id === id);
  if (!current) throw new Error("Skill 不存在");
  const snapshot: SkillVersion = { id: `SV-${randomUUID().slice(0, 10)}`, skillId: id, module, version: current.version, snapshot: current, changeNote: changeNote || "保存前自动快照", hash: createHash("sha256").update(JSON.stringify(current), "utf8").digest("hex"), createdAt: new Date().toISOString() };
  saveVersions([snapshot, ...loadVersions()].slice(0, 500));
  const allowed: Partial<SkillDefinition> = {};
  for (const key of ["name", "description", "useWhen", "notFor", "requiredInputs", "outputContract", "prompt", "model", "temperature", "enabled"] as const) {
    if (patch[key] !== undefined) Object.assign(allowed, { [key]: patch[key] });
  }
  return { skill: patchSkill(id, allowed), snapshot };
}

export function listSkillVersions(module: ProductModule, skillId: string) {
  if (!skillId.startsWith(prefix(module))) throw new Error("Skill 不属于当前模块");
  return loadVersions().filter((item) => item.module === module && item.skillId === skillId);
}

export function restoreSkillVersion(module: ProductModule, skillId: string, versionId: string) {
  const version = loadVersions().find((item) => item.id === versionId && item.module === module && item.skillId === skillId);
  if (!version) throw new Error("Skill 版本不存在");
  return updateModuleSkill(module, skillId, version.snapshot, `回滚到快照 ${version.id}`);
}

export function skillVersionDiff(module: ProductModule, skillId: string, versionId: string) {
  const version = loadVersions().find((item) => item.id === versionId && item.module === module && item.skillId === skillId);
  const current = getSkills().find((item) => item.id === skillId);
  if (!version || !current) throw new Error("Skill 或版本不存在");
  const fields = ["name", "description", "useWhen", "notFor", "requiredInputs", "outputContract", "prompt", "model", "temperature", "enabled"] as const;
  return fields.flatMap((field) => JSON.stringify(version.snapshot[field]) === JSON.stringify(current[field]) ? [] : [{ field, before: version.snapshot[field], after: current[field] }]);
}
