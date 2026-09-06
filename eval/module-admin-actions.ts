import { pipelineFor } from "../agent/capability-manifest.js";
import { getSkills, tools } from "../agent/catalog.js";
import { getModelConfig } from "../agent/model-config.js";
import { AUDIT_RULES } from "../server/src/services/audit-rules.js";
import type { ProductModule } from "./module-types.js";
import { getPlannerConfig } from "./module-planner-store.js";

export async function previewModulePlan(module: ProductModule, question: string) {
  const enabledSkills = new Set(getSkills().filter((item) => item.enabled).map((item) => item.id));
  const enabledTools = new Set(tools.filter((item) => item.enabled).map((item) => item.id));
  const config = getPlannerConfig(module);
  const runtimePipeline = pipelineFor(module).map((step, index) => ({
    ...step,
    stepId: module + "-runtime-" + (index + 1),
    enabled: step.capabilityType === "skill" ? enabledSkills.has(step.id) : enabledTools.has(step.id),
  }));
  const plan = {
    planner: "production-runtime-manifest",
    steps: runtimePipeline.filter((step) => step.enabled).map((step) => ({
      id: step.stepId,
      capabilityType: step.capabilityType,
      capabilityId: step.id,
      purpose: step.purpose,
    })),
    note: "该预览直接镜像生产 Worker 能力顺序，不调用 RedFox，不使用静态候选。",
  };
  const mandatory = config.mandatorySkills;
  const selected = new Set(plan.steps.map((step) => step.capabilityId));
  const validationErrors = [
    ...runtimePipeline.filter((step) => !step.enabled && !step.optional).map((step) => "生产必需能力未启用或不存在：" + step.id),
    ...mandatory.filter((id) => !selected.has(id)).map((id) => `缺少必需能力：${id}`),
  ];
  const model = getModelConfig();
  return {
    question,
    testMode: "runtime_manifest_validation",
    modelCalled: false,
    redfoxCalled: false,
    databaseWritten: false,
    runtimeSource: "production-runtime-manifest",
    plannerConfigUpdatedAt: config.updatedAt,
    systemPrompt: config.systemPrompt,
    model: { provider: model.text.provider, model: model.text.model, temperature: config.model.temperature, maxTokens: config.model.maxTokens },
    plan,
    runtimePipeline,
    mandatorySkills: mandatory,
    valid: validationErrors.length === 0,
    validationErrors,
    enabledSkills: [...enabledSkills],
    enabledTools: [...enabledTools],
  };
}

export function testModuleTool(module: ProductModule, id: string, input: Record<string, unknown>) {
  const allowed = tools.find((item) => item.id === id && (module === "creators" ? !item.id.startsWith("audit_") : item.id.startsWith("audit_")));
  if (!allowed) throw new Error("Tool 不属于当前模块或不存在");
  if (!allowed.enabled) throw new Error("Tool 已停用");
  const started = Date.now();
  const candidates = Array.isArray(input.candidates) ? input.candidates as Array<Record<string, unknown>> : [];
  let output: unknown;
  if (id === "load_candidates") output = { count: candidates.length, candidates };
  else if (id === "dedupe_candidates") {
    const seen = new Set<string>();
    const deduped = candidates.filter((item) => {
      const key = String(item.id ?? item.profileUrl ?? item.handle ?? item.nickname ?? "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    output = { before: candidates.length, after: deduped.length, candidates: deduped };
  } else if (id === "rank_candidates") output = [...candidates].sort((a, b) => Number(b.matchScore ?? 0) - Number(a.matchScore ?? 0) || Number(b.activity ?? 0) - Number(a.activity ?? 0));
  else if (id === "persist_run") output = { accepted: Boolean(input.run), note: "测试只校验结构，不写入正式运行记录。" };
  else if (id === "redfox_search_notes") output = { mode: "contract_validation", providerCalled: false, required: ["keywords", "cursor", "pageBudget"], note: "真实调用由生产 Worker 的 RedfoxXhsClient 执行；管理页测试不会消耗 RedFox。" };
  else if (id === "redfox_account_detail") output = { mode: "contract_validation", providerCalled: false, required: ["platformCreatorId"], note: "账号详情只在生产检索中按需读取。" };
  else if (id === "redfox_posted_notes") output = { mode: "contract_validation", providerCalled: false, required: ["platformCreatorId"], note: "作品列表只在近期点赞或活跃度证据不足时读取。" };
  else if (id === "redfox_note_detail") output = { mode: "contract_validation", providerCalled: false, required: ["noteId"], note: "笔记详情只在搜索结果证据不足时补查。" };
  else if (id === "load_search_session") output = { mode: "contract_validation", databaseWritten: false, required: ["projectId", "searchKey"], note: "生产环境从 creator_search_sessions 和 creator_search_screenings 读取。" };
  else if (id === "save_search_progress") output = { mode: "contract_validation", databaseWritten: false, required: ["sessionId", "cursor", "screenings"], note: "管理页测试不写业务数据库。" };
  else if (id === "persist_creator_result") output = { mode: "contract_validation", databaseWritten: false, required: ["creator", "projectCreator", "evidence"], note: "管理页测试不写业务数据库。" };
  else if (id === "audit_retrieve_knowledge") output = { chunks: Array.isArray(input.knowledgeChunks) ? input.knowledgeChunks.length : 0 };
  else if (id === "audit_deterministic_rule_scan") {
    const text = String(input.text ?? "");
    output = AUDIT_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => ({ id: rule.id, category: rule.category, riskLevel: rule.riskLevel, lawRef: rule.lawRef }));
  } else if (id === "audit_load_assets") output = { assets: Array.isArray(input.assetUrls) ? input.assetUrls : [], count: Array.isArray(input.assetUrls) ? input.assetUrls.length : 0 };
  else if (id === "audit_persist_findings") output = { valid: Array.isArray(input.findings), count: Array.isArray(input.findings) ? input.findings.length : 0, note: "测试模式不写入业务数据库。" };
  else if (id === "audit_persist_snapshots") output = { mode: "contract_validation", databaseWritten: false, snapshots: Array.isArray(input.snapshots) ? input.snapshots.length : 0 };
  else if (id === "audit_persist_coverage_warnings") output = { mode: "contract_validation", databaseWritten: false, warnings: Array.isArray(input.warnings) ? input.warnings.length : 0 };
  else throw new Error("Tool 暂无测试实现");
  const contractOnly = new Set([
    "persist_run", "redfox_search_notes", "redfox_account_detail", "redfox_posted_notes", "redfox_note_detail",
    "load_search_session", "save_search_progress", "persist_creator_result", "audit_persist_findings",
    "audit_persist_snapshots", "audit_persist_coverage_warnings",
  ]).has(id);
  return {
    id,
    testMode: contractOnly ? "contract_validation" : "local_execution",
    externalServiceCalled: false,
    databaseWritten: false,
    input,
    output,
    durationMs: Date.now() - started,
    status: "completed",
  };
}
