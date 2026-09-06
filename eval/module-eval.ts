import { randomUUID } from "node:crypto";
import { getSkills } from "../agent/catalog.js";
import {
  getModuleBatch, loadModuleBatches, loadModuleCases, loadModuleRuns, putModuleBatch, putModuleRun,
  saveModuleCases, stableHash, upsertModuleCase,
} from "./module-store.js";
import type { ModuleEvalBatch, ModuleEvalCase, ModuleEvalRun, ModuleEvalStatus, ProductModule } from "./module-types.js";
import { getModelConfig } from "../agent/model-config.js";
import { runRealAuditSystemTest, runRealCreatorSystemTest } from "./real-system-eval.js";
function modelRuntime(){const config=getModelConfig();const textReady=Boolean(process.env[config.text.apiKeyEnv]);const visionReady=Boolean(process.env[config.vision.apiKeyEnv]);return {provider:textReady?config.text.provider:`${config.text.provider}-unconfigured`,model:config.text.model,visionProvider:visionReady?config.vision.provider:`${config.vision.provider}-unconfigured`,visionModel:config.vision.model,textReady,visionReady}}

export const MODULE_EVALUATOR_VERSION = "adproof-module-eval-v6-creator-coverage";
const now = () => new Date().toISOString();

type CreatorSeed = Pick<ModuleEvalCase,
  "id" | "name" | "question" | "category" | "difficulty" | "riskLevel" | "expectedBehavior"
  | "requiredCapabilities" | "evalDimensions"
> & Partial<Pick<ModuleEvalCase, "enabled" | "analysisMode" | "minimumPersistedCount" | "tags">>;

function creatorSeed(input: CreatorSeed, createdAt: string): ModuleEvalCase {
  return {
    ...input,
    module: "creators",
    expectedKeywords: { all: ["targetCount", "stageCounts"] },
    forbiddenWords: [],
    forbiddenCapabilities: [],
    enabled: input.enabled ?? true,
    source: "seed",
    dataSource: "redfox",
    analysisMode: input.analysisMode ?? "multimodal",
    minimumPersistedCount: input.minimumPersistedCount ?? 20,
    fixture: {},
    createdAt,
    updatedAt: createdAt,
  };
}

function seedCases(): ModuleEvalCase[] {
  const createdAt = now();
  const rows: ModuleEvalCase[] = [
    creatorSeed({
      id: "creator-intent-01", name: "千粉以内医美经历筛选", question: "粉丝小于1500，活跃度较高，做过光子嫩肤的素人达人",
      category: "意图解析", difficulty: "medium", riskLevel: "low",
      expectedBehavior: ["解析粉丝上限和活跃要求", "判断个人账号与本人经历", "返回20个新达人或明确数据源耗尽"],
      requiredCapabilities: ["creator_intent_structuring", "creator_personal_account_assessment", "creator_experience_evidence", "creator_semantic_matching", "creator_history_exclusion", "creator_ranking", "creator_continuation_control"],
      evalDimensions: ["correctness", "relevance", "coverage", "trace"], tags: ["smoke", "intent", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-semantic-01", name: "雀斑与产后斑语义匹配", question: "找有雀斑、晒斑或产后斑困扰的素人",
      category: "语义匹配", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["理解同义皮肤问题", "区分本人经历与泛话题", "展示具体笔记证据并标记不确定项"],
      requiredCapabilities: ["creator_intent_structuring", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_summary", "creator_evidence_grounding", "creator_continuation_control"],
      evalDimensions: ["relevance", "evidence", "uncertainty", "coverage"], tags: ["semantic", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-dedupe-01", name: "重复达人排除", question: "重新检索光子嫩肤达人，不能重复返回当前项目已经看过、已选入或已弃用的博主",
      category: "历史排除", difficulty: "easy", riskLevel: "low",
      expectedBehavior: ["同一平台达人只返回一次", "排除项目历史达人", "排除后继续检索新达人"],
      requiredCapabilities: ["creator_history_exclusion", "creator_ranking", "creator_continuation_control"],
      evalDimensions: ["correctness", "coverage", "trace"], analysisMode: "text_rules", tags: ["dedupe", "history", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-full-criteria-01", name: "医美复合条件与20人续检",
      question: "找1000-5000粉丝的个人博主，做过光子嫩肤、超声炮、热玛吉、皮秒或点阵，或者本人有玫瑰皮肤、晒斑、雀斑困扰；必须发过相关笔记，近三个月至少一篇笔记点赞10以上，每次返回20个未在当前项目检索过的新达人",
      category: "综合回归", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["解析粉丝区间、近90天点赞和个人账号硬条件", "正确处理医美经历与皮肤困扰的或关系", "排除项目历史并持续检索至20人或数据源耗尽", "每个达人保留可人工核验的笔记证据"],
      requiredCapabilities: ["creator_intent_structuring", "creator_search_strategy", "creator_history_exclusion", "creator_hard_filtering", "creator_note_evidence_selection", "creator_personal_account_assessment", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_grounding", "creator_ranking", "creator_continuation_control"],
      evalDimensions: ["correctness", "relevance", "evidence", "coverage", "trace"], tags: ["critical", "compound", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-hard-filter-01", name: "粉丝区间与近期点赞硬筛选",
      question: "找粉丝1000-5000、近90天至少一篇笔记点赞10以上、最近仍有更新的个人博主",
      category: "硬条件筛选", difficulty: "medium", riskLevel: "low",
      expectedBehavior: ["按公开粉丝数执行区间筛选", "验证近90天笔记点赞门槛", "证据不足时补查作品而不是直接猜测"],
      requiredCapabilities: ["creator_intent_structuring", "creator_hard_filtering", "creator_note_evidence_selection", "creator_personal_account_assessment", "creator_continuation_control"],
      evalDimensions: ["correctness", "evidence", "coverage", "trace"], tags: ["hard-filter", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-personal-account-01", name: "个人博主与机构门店排除",
      question: "找本人做过热玛吉的个人博主，排除医院、医美机构、门店、医生账号和品牌官方账号",
      category: "账号识别", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["结合昵称、简介和主页内容识别账号主体", "排除机构、门店、医生和品牌官方账号", "不能把机构案例包装成个人经历"],
      requiredCapabilities: ["creator_personal_account_assessment", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_grounding", "creator_continuation_control"],
      evalDimensions: ["correctness", "relevance", "evidence", "coverage"], tags: ["account-type", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-experience-01", name: "本人经历与泛科普区分",
      question: "找本人做过皮秒并记录恢复过程的博主，不要只转发医美科普、他人案例或机构宣传的账号",
      category: "经历证据", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["识别第一人称项目和恢复经历", "排除转载科普、他人案例与营销转述", "将结论绑定到代表笔记"],
      requiredCapabilities: ["creator_note_evidence_selection", "creator_personal_account_assessment", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_grounding", "creator_continuation_control"],
      evalDimensions: ["relevance", "evidence", "uncertainty", "coverage"], tags: ["personal-experience", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-ranking-01", name: "证据质量与活跃度排序",
      question: "找做过点阵激光的个人博主，优先近期发布、本人经历证据清晰、互动活跃且资料完整的人",
      category: "排序", difficulty: "medium", riskLevel: "low",
      expectedBehavior: ["先满足硬条件和语义条件再排序", "证据质量优先于单纯粉丝量", "同分时使用活跃度和资料完整度稳定排序"],
      requiredCapabilities: ["creator_note_evidence_selection", "creator_experience_evidence", "creator_semantic_matching", "creator_ranking", "creator_evidence_grounding", "creator_continuation_control"],
      evalDimensions: ["relevance", "ranking", "evidence", "coverage"], tags: ["ranking", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-history-continuation-01", name: "历史排除后继续补足20人",
      question: "继续检索医美体验博主，排除当前项目已看过、已选入和已弃用的达人，并从上次游标继续补足20个新达人",
      category: "续检控制", difficulty: "hard", riskLevel: "low",
      expectedBehavior: ["读取相同条件的检索会话和历史筛选记录", "不重复处理已看过达人", "从持久化游标继续并补足20人", "保存本次游标和筛选原因"],
      requiredCapabilities: ["creator_search_strategy", "creator_history_exclusion", "creator_ranking", "creator_continuation_control"],
      evalDimensions: ["correctness", "coverage", "state", "trace"], tags: ["continuation", "history", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-search-strategy-01", name: "医美同义词与长尾词召回",
      question: "找做过超声炮、热玛吉等抗衰项目，或者记录面部松弛、下颌线模糊困扰的个人博主",
      category: "召回策略", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["生成项目词、症状词和个人经历长尾词", "轮转基础词、长尾词和宽召回词", "避免只用一个关键词检索一次就结束"],
      requiredCapabilities: ["creator_intent_structuring", "creator_search_strategy", "creator_experience_evidence", "creator_semantic_matching", "creator_continuation_control"],
      evalDimensions: ["recall", "relevance", "coverage", "trace"], tags: ["search-strategy", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-evidence-grounding-01", name: "证据绑定与人工可复核摘要",
      question: "找有真实皮秒祛斑经历的个人博主，每个结果必须给出具体笔记、发布时间、内容依据和匹配理由",
      category: "证据归因", difficulty: "medium", riskLevel: "medium",
      expectedBehavior: ["选择最能证明本人经历的代表笔记", "记录笔记与采集时间", "匹配结论必须能追溯到文本或图片证据", "生成简洁的人工复核摘要"],
      requiredCapabilities: ["creator_note_evidence_selection", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_summary", "creator_evidence_grounding", "creator_continuation_control"],
      evalDimensions: ["evidence", "traceability", "relevance", "coverage"], tags: ["evidence", "target-20"],
    }, createdAt),
    creatorSeed({
      id: "creator-image-evidence-01", name: "图片文字补充医美项目证据",
      question: "找正文没有明确写项目名，但图片中能看到光子嫩肤项目、仪器名称或术后恢复记录的个人博主",
      category: "多模态证据", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["仅在文本证据不足时读取图片", "识别图片可见文字和项目线索", "图片证据不充分时标记不确定而不是强判命中"],
      requiredCapabilities: ["creator_image_understanding", "creator_personal_account_assessment", "creator_experience_evidence", "creator_semantic_matching", "creator_evidence_grounding"],
      evalDimensions: ["vision", "evidence", "uncertainty", "trace"], enabled: false, minimumPersistedCount: 1, tags: ["on-demand", "vision", "expensive"],
    }, createdAt),
    creatorSeed({
      id: "creator-exhaustion-01", name: "极窄条件候选耗尽处理",
      question: "找粉丝1000-1200、近7天发过热玛吉恢复日记且单篇点赞1000以上的个人博主",
      category: "边界与降级", difficulty: "hard", riskLevel: "medium",
      expectedBehavior: ["在安全调用预算内继续分页和切换关键词", "候选耗尽时明确返回部分完成原因", "不得用不符合条件的人数凑满20"],
      requiredCapabilities: ["creator_search_strategy", "creator_hard_filtering", "creator_experience_evidence", "creator_semantic_matching", "creator_continuation_control"],
      evalDimensions: ["correctness", "coverage", "degradation", "trace"], enabled: false, minimumPersistedCount: 1, tags: ["on-demand", "exhaustion", "expensive"],
    }, createdAt),
    ...[
      ["audit-ad-law-01", "广告法极限词审核", "审核这篇小红书图文：全网第一、百分百有效、彻底祛斑", "high"],
      ["audit-medical-01", "医疗功效断言", "一针见效，根治色斑，无副作用。", "high"],
      ["audit-citation-01", "引证内容无出处", "研究显示，超过90%的用户感到满意。", "medium"],
      ["audit-safe-01", "安全表达", "使用感受因人而异，仅代表个人体验。", "low"],
    ].map(([id, name, question, expectedRisk]) => ({
      id, module: "audit" as const, name, question, category: "广告法审核", difficulty: expectedRisk === "low" ? "easy" as const : "medium" as const,
      riskLevel: expectedRisk === "high" ? "high" as const : expectedRisk === "medium" ? "medium" as const : "low" as const,
      expectedBehavior: expectedRisk === "low" ? ["不新增不存在的风险", "保留人工复核说明"] : ["定位风险表达", "给出规则依据与修改建议"],
      expectedKeywords: expectedRisk === "low" ? {} : { any: [String(name), "风险", "修改"] }, forbiddenWords: ["法律最终结论"],
      expectedRisk: expectedRisk as "low" | "medium" | "high", requiredCapabilities: ["audit_retrieve_knowledge", "audit_deterministic_rule_scan", "audit_text_compliance", "audit_risk_decision", "audit_review_summary"],
      forbiddenCapabilities: [], evalDimensions: ["correctness", "safety", "evidence", "trace"], enabled: true, source: "seed" as const,
      dataSource: "advertising-law" as const, analysisMode: "multimodal" as const, fixture: {}, createdAt, updatedAt: createdAt,
    })),
  ];
  return rows;
}

export function ensureModuleCases(): ModuleEvalCase[] {
  const current = loadModuleCases();
  const byId = new Map(current.map((item) => [item.id, item]));
  let changed = false;
  for (const seed of seedCases()) {
    const existing = byId.get(seed.id);
    const comparable = (item: ModuleEvalCase) => {
      const { enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = item;
      return definition;
    };
    const needsRepair = !existing || existing.source !== "seed"
      || stableHash(comparable(existing)) !== stableHash(comparable(seed));
    if (needsRepair) {
      byId.set(seed.id, existing ? { ...seed, enabled: existing.enabled, createdAt: existing.createdAt, updatedAt: now() } : seed);
      changed = true;
    }
  }
  const rows = [...byId.values()];
  if (changed || !current.length) saveModuleCases(rows);
  return rows;
}

export function listCases(module: ProductModule, enabledOnly = false): ModuleEvalCase[] {
  ensureModuleCases();
  return loadModuleCases(module).filter((item) => !enabledOnly || item.enabled);
}

export function validateModuleCaseDraft(input: Partial<ModuleEvalCase> & { id: string; name: string; question: string }): void {
  const id = String(input.id ?? "").trim();
  const name = String(input.name ?? "").trim();
  const question = String(input.question ?? "").trim();
  const expectedBehavior = Array.isArray(input.expectedBehavior)
    ? input.expectedBehavior.map((item) => String(item).trim()).filter(Boolean)
    : [];
  if (!/^[a-z][a-z0-9_-]{2,79}$/i.test(id)) throw new Error("用例 ID 必须以字母开头，只能包含字母、数字、下划线和短横线，长度为 3-80 个字符");
  if (name.length < 2 || !/[^\d\s]/.test(name)) throw new Error("用例名称至少 2 个字符，且不能只有数字");
  if (question.length < 8 || !/[^\d\s]/.test(question)) throw new Error("测试问题至少 8 个字符，且必须描述可执行的业务条件");
  if (!expectedBehavior.length) throw new Error("至少填写一条期望行为，避免创建无法判定的空评测");
  if (input.minimumPersistedCount !== undefined && (!Number.isInteger(input.minimumPersistedCount) || input.minimumPersistedCount < 0 || input.minimumPersistedCount > 20)) {
    throw new Error("最少结果数必须是 0-20 的整数");
  }
}

export function saveCase(module: ProductModule, input: Partial<ModuleEvalCase> & { id: string; name: string; question: string }): ModuleEvalCase {
  const current = loadModuleCases(module).find((item) => item.id === input.id);
  const merged = { ...current, ...input, id: input.id, name: input.name, question: input.question };
  validateModuleCaseDraft(merged);
  const timestamp = now();
  return upsertModuleCase({
    id: input.id.trim(), module, name: input.name.trim(), question: input.question.trim(), category: input.category ?? current?.category ?? "通用",
    difficulty: input.difficulty ?? current?.difficulty ?? "medium", riskLevel: input.riskLevel ?? current?.riskLevel ?? "low",
    expectedBehavior: input.expectedBehavior ?? current?.expectedBehavior ?? [], expectedKeywords: input.expectedKeywords ?? current?.expectedKeywords ?? {},
    expectedReply: input.expectedReply ?? current?.expectedReply, expectedPrice: input.expectedPrice ?? current?.expectedPrice, expectedRiskPassed: input.expectedRiskPassed ?? current?.expectedRiskPassed,
    minimumPersistedCount: input.minimumPersistedCount ?? current?.minimumPersistedCount ?? (module === "creators" ? 20 : undefined),
    llmJudgePrompt: input.llmJudgePrompt ?? current?.llmJudgePrompt, tags: input.tags ?? current?.tags ?? [], sourceRunId: input.sourceRunId ?? current?.sourceRunId,
    forbiddenWords: input.forbiddenWords ?? current?.forbiddenWords ?? [], expectedRisk: input.expectedRisk ?? current?.expectedRisk,
    requiredCapabilities: input.requiredCapabilities ?? current?.requiredCapabilities ?? [], forbiddenCapabilities: input.forbiddenCapabilities ?? current?.forbiddenCapabilities ?? [],
    evalDimensions: input.evalDimensions ?? current?.evalDimensions ?? ["correctness"], enabled: input.enabled ?? current?.enabled ?? true,
    source: current?.source ?? "manual", fixture: input.fixture ?? current?.fixture ?? {}, createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp,
  });
}

function keywordScore(actual: string, expected: ModuleEvalCase["expectedKeywords"], forbiddenWords: string[]) {
  const all = expected.all ?? [];
  const any = expected.any ?? [];
  const keywordHits = [...all, ...any].filter((word) => actual.includes(word));
  const keywordMisses = [...all.filter((word) => !actual.includes(word)), ...(any.length && !any.some((word) => actual.includes(word)) ? any : [])];
  const forbiddenHits = forbiddenWords.filter((word) => actual.includes(word));
  return { keywordHits, keywordMisses, forbiddenHits, keywordsPassed: all.every((word) => actual.includes(word)) && (!any.length || any.some((word) => actual.includes(word))) };
}

function statusFor(input: { error?: string; pending: boolean; keywordsPassed: boolean; forbiddenHits: string[]; capabilityMisses: string[]; riskPassed: boolean }): ModuleEvalStatus {
  if (input.error) return "ERROR";
  if (input.forbiddenHits.length || !input.riskPassed) return "FAIL";
  if (input.pending || input.capabilityMisses.length || !input.keywordsPassed) return "REVIEW";
  return "PASS";
}

async function executeCreatorCase(item: ModuleEvalCase): Promise<Omit<ModuleEvalRun, "id" | "createdAt" | "durationMs">> {
  const result = await runRealCreatorSystemTest(item.question);
  const task = result.task;
  const stageCounts = task.stage_counts ?? {};
  const capabilities = [
    "creator_intent_structuring", "creator_search_strategy", "creator_history_exclusion", "creator_hard_filtering",
    "creator_note_evidence_selection", "creator_personal_account_assessment", "creator_experience_evidence",
    "creator_semantic_matching", "creator_image_understanding", "creator_evidence_summary", "creator_evidence_grounding",
    "creator_ranking", "creator_continuation_control",
  ];
  const actual = JSON.stringify({
    source: "redfox",
    project: result.context,
    task: {
      id: task.id, status: task.status, terminal: task.terminal, targetCount: task.target_count,
      collectedCount: task.collected_count, persistedCount: task.persisted_count,
      minimumPersistedCount: item.minimumPersistedCount ?? 20,
      duplicateCount: task.duplicate_count, stageCounts, errorCode: task.error_code, errorMessage: task.error_message,
    },
    candidates: result.creators,
    runtime: { keySource: result.keySource, keyFingerprint: result.keyFingerprint },
    workerResult: result.jobResult,
  }, null, 2);
  const score = keywordScore(actual, item.expectedKeywords, item.forbiddenWords);
  const capabilityMisses = item.requiredCapabilities.filter((id) => !capabilities.includes(id));
  const forbiddenCapabilities = item.forbiddenCapabilities.filter((id) => capabilities.includes(id));
  const taskFailed = ["failed", "session_expired", "cancelled"].includes(task.status);
  const minimumPersistedCount = item.minimumPersistedCount ?? 20;
  const coveragePassed = task.persisted_count >= minimumPersistedCount;
  const status = statusFor({ error: taskFailed ? task.error_message ?? task.status : undefined, pending: !task.terminal || !coveragePassed, keywordsPassed: score.keywordsPassed, forbiddenHits: [...score.forbiddenHits, ...forbiddenCapabilities], capabilityMisses, riskPassed: true });
  return {
    module: "creators", dataSource: "redfox", analysisMode: "multimodal", caseId: item.id, question: item.question, status, passed: status === "PASS",
    reason: taskFailed
      ? `真实检索任务失败：${task.error_message ?? task.status}`
      : status === "PASS"
        ? `真实检索完成，新增 ${task.persisted_count}/${task.target_count} 人，达到用例门槛 ${minimumPersistedCount} 人。`
        : `真实检索完成，新增 ${task.persisted_count}/${task.target_count} 人，未达到用例门槛 ${minimumPersistedCount} 人，需要人工确认覆盖度。`,
    actual, evidence: [`项目:${result.context.projectName}`, `任务:${task.id}`, `数量门槛:${minimumPersistedCount}`, `RedFox Key:${result.keySource}#${result.keyFingerprint ?? "none"}`, ...Object.entries(stageCounts).map(([key, value]) => `${key}:${value}`)], keywordHits: score.keywordHits, keywordMisses: score.keywordMisses,
    forbiddenHits: [...score.forbiddenHits, ...forbiddenCapabilities], capabilityHits: capabilities, capabilityMisses, riskIssues: [], agentStatus: task.status,
    agentRunId: task.id, trace: [{ task }, { workerResult: result.jobResult }], provider: `redfox+${modelRuntime().provider}`, model: modelRuntime().model, evaluatorVersion: MODULE_EVALUATOR_VERSION,
  };
}

async function executeAuditCase(item: ModuleEvalCase): Promise<Omit<ModuleEvalRun, "id" | "createdAt" | "durationMs">> {
  const result = await runRealAuditSystemTest({ title: item.name, body: item.question, requirements: "依据公共知识库、广告法与系统审核规则进行真实审核" });
  const task = result.task;
  const agentSteps = Array.isArray(result.jobResult?.agent_steps) ? result.jobResult.agent_steps as Array<Record<string, unknown>> : [];
  const capabilities = [...new Set([
    "audit_retrieve_knowledge", "audit_deterministic_rule_scan", "audit_evidence_grounding", "audit_review_summary",
    ...agentSteps.map((step) => String(step.id ?? "")).filter(Boolean),
  ])];
  const actualRisk = String(task.overall_risk ?? "needs_confirmation");
  const actual = JSON.stringify({ source: "system", project: result.context, task, findings: result.findings, coverageWarnings: result.coverageWarnings, workerResult: result.jobResult }, null, 2);
  const score = keywordScore(actual, item.expectedKeywords, item.forbiddenWords);
  const capabilityMisses = item.requiredCapabilities.filter((id) => !capabilities.includes(id));
  const forbiddenCapabilities = item.forbiddenCapabilities.filter((id) => capabilities.includes(id));
  const expectedRisk = item.expectedRisk;
  const riskPassed = !expectedRisk || actualRisk === expectedRisk || (expectedRisk === "low" && actualRisk === "needs_confirmation");
  const riskIssues = riskPassed ? [] : [`期望风险 ${expectedRisk}，实际风险 ${actualRisk}`];
  const taskFailed = String(task.status) === "failed";
  const agentStatus = String(result.jobResult?.agent_status ?? task.status);
  const status = statusFor({ error: taskFailed ? String(task.error_code ?? task.status) : undefined, pending: String(task.status) !== "completed" || agentStatus !== "scored", keywordsPassed: score.keywordsPassed, forbiddenHits: [...score.forbiddenHits, ...forbiddenCapabilities], capabilityMisses, riskPassed });
  return {
    module: "audit", dataSource: "advertising-law", analysisMode: "multimodal", caseId: item.id, question: item.question, status, passed: status === "PASS",
    reason: taskFailed ? `真实审核任务失败：${String(task.error_code ?? task.status)}` : status === "PASS" ? `真实审核完成，识别 ${result.findings.length} 个风险项。` : "真实审核已完成，但风险结果或证据覆盖需要人工复核。",
    actual, evidence: [`审核任务:${String(task.id)}`, `风险项:${result.findings.length}`, `覆盖警告:${result.coverageWarnings.length}`, ...agentSteps.map((step) => `${String(step.id)}:${String(step.status)}`)], keywordHits: score.keywordHits, keywordMisses: score.keywordMisses,
    forbiddenHits: [...score.forbiddenHits, ...forbiddenCapabilities], capabilityHits: capabilities, capabilityMisses, riskIssues, agentStatus,
    agentRunId: String(task.id), trace: [{ task }, ...agentSteps], provider: modelRuntime().provider, model: modelRuntime().model, evaluatorVersion: MODULE_EVALUATOR_VERSION,
  };
}

export async function runCase(module: ProductModule, caseId: string): Promise<ModuleEvalRun> {
  const item = listCases(module).find((candidate) => candidate.id === caseId);
  if (!item) throw new Error(`评测用例不存在：${caseId}`);
  const started = Date.now();
  try {
    const core = module === "creators" ? await executeCreatorCase(item) : await executeAuditCase(item);
    return putModuleRun({ ...core, id: `ER-${randomUUID().slice(0, 10)}`, createdAt: now(), durationMs: Date.now() - started });
  } catch (error) {
    return putModuleRun({
      id: `ER-${randomUUID().slice(0, 10)}`, module, dataSource: module === "creators" ? "redfox" : "advertising-law", analysisMode: "multimodal", caseId, question: item.question, status: "ERROR", passed: false,
      reason: "Agent 执行发生错误。", actual: "", evidence: [], keywordHits: [], keywordMisses: [], forbiddenHits: [], capabilityHits: [], capabilityMisses: item.requiredCapabilities,
      riskIssues: [], agentStatus: "error", agentRunId: "", trace: [], provider: modelRuntime().provider,
      model: modelRuntime().model, evaluatorVersion: MODULE_EVALUATOR_VERSION, durationMs: Date.now() - started, createdAt: now(), error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface ModuleCaseExecution {
  module: ProductModule;
  caseId: string;
  status: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  run: ModuleEvalRun | null;
  error: string | null;
}

const caseExecutions = new Map<string, ModuleCaseExecution>();

export function startCaseRun(module: ProductModule, caseId: string): ModuleCaseExecution {
  if (!listCases(module).some((item) => item.id === caseId)) throw new Error(`评测用例不存在：${caseId}`);
  const key = `${module}:${caseId}`;
  const current = caseExecutions.get(key);
  if (current?.status === "running") return current;
  const execution: ModuleCaseExecution = {
    module, caseId, status: "running", startedAt: now(), finishedAt: null, run: null, error: null,
  };
  caseExecutions.set(key, execution);
  void runCase(module, caseId).then((run) => {
    Object.assign(execution, { status: "done", finishedAt: now(), run });
  }).catch((error) => {
    Object.assign(execution, { status: "error", finishedAt: now(), error: error instanceof Error ? error.message : String(error) });
  });
  return execution;
}

export function getCaseRunState(module: ProductModule, caseId: string): ModuleCaseExecution | null {
  return caseExecutions.get(`${module}:${caseId}`) ?? null;
}

function counts(runs: ModuleEvalRun[]) {
  return { passed: runs.filter((run) => run.status === "PASS").length, failed: runs.filter((run) => run.status === "FAIL").length, review: runs.filter((run) => run.status === "REVIEW").length, errors: runs.filter((run) => run.status === "ERROR").length };
}

export function createBatch(module: ProductModule, input: { name?: string; versionLabel?: string; changeNote?: string; caseIds?: string[]; caseIdsProvided?: boolean }): ModuleEvalBatch {
  const enabled = listCases(module, true);
  if (input.caseIdsProvided && Array.isArray(input.caseIds) && input.caseIds.length === 0) throw new Error("caseIds 不能为空数组");
  const requested = input.caseIds ?? enabled.map((item) => item.id);
  const invalidIds = requested.filter((id) => !enabled.some((item) => item.id === id));
  if (invalidIds.length) throw new Error("无效或已停用的 caseIds: " + invalidIds.join(", "));
  const selected = requested.map((id) => enabled.find((item) => item.id === id)!).filter(Boolean);
  if (!selected.length) throw new Error("没有可运行的评测用例");
  const batch: ModuleEvalBatch = {
    id: `MB-${randomUUID().slice(0, 10)}`, module, dataSource: module === "creators" ? "redfox" : "advertising-law", analysisMode: "multimodal", name: input.name ?? `${module === "creators" ? "达人" : "审核"}回归评测`, versionLabel: input.versionLabel ?? "workspace",
    changeNote: input.changeNote ?? "", caseIds: selected.map((item) => item.id), caseSnapshot: selected, caseSetHash: stableHash(selected), evaluatorVersion: MODULE_EVALUATOR_VERSION,
    provider: modelRuntime().provider, model: modelRuntime().model, status: "queued", currentIndex: 0,
    total: selected.length, passed: 0, failed: 0, review: 0, errors: 0, runIds: [], createdAt: now(), startedAt: null, finishedAt: null,
  };
  return putModuleBatch(batch);
}

export async function executeBatch(module: ProductModule, id: string): Promise<ModuleEvalBatch> {
  const initial = getModuleBatch(id, module);
  if (!initial) throw new Error("评测批次不存在");
  let batch: ModuleEvalBatch = initial;
  batch = putModuleBatch({ ...batch, status: "running", startedAt: batch.startedAt ?? now(), error: undefined });
  try {
    for (let index = 0; index < batch.caseIds.length; index += 1) {
      const latest = getModuleBatch(id, module);
      if (latest?.status === "cancelled") return latest;
      const run = await runCase(module, batch.caseIds[index]);
      const runIds = [...batch.runIds, run.id];
      const batchRuns = loadModuleRuns(module).filter((item) => runIds.includes(item.id));
      batch = putModuleBatch({ ...batch, ...counts(batchRuns), runIds, currentIndex: index + 1 });
    }
    const batchRuns = loadModuleRuns(module).filter((item) => batch.runIds.includes(item.id));
    batch = putModuleBatch({ ...batch, ...counts(batchRuns), status: "done", currentIndex: batch.total, finishedAt: now() });
    return batch;
  } catch (error) {
    return putModuleBatch({ ...batch, status: "error", finishedAt: now(), error: error instanceof Error ? error.message : String(error) });
  }
}

export function moduleOverview(module: ProductModule) {
  const cases = listCases(module);
  const allBatches = loadModuleBatches(module);
  const allRuns = loadModuleRuns(module);
  const batches = allBatches.filter((item) => item.evaluatorVersion === MODULE_EVALUATOR_VERSION);
  const runs = allRuns.filter((item) => item.evaluatorVersion === MODULE_EVALUATOR_VERSION);
  const latest = batches[0];
  const enabledSkills = getSkills().filter((item) => item.enabled && item.id.startsWith(module === "creators" ? "creator_" : "audit_"));
  return {
    module,
    dataSource: module === "creators" ? "redfox" : "advertising-law",
    productionDataSource: module === "creators" ? "redfox" : "knowledge-base-and-assets",
    analysisMode: "multimodal",
    cases,
    executions: cases.map((item) => getCaseRunState(module, item.id)).filter((item): item is ModuleCaseExecution => Boolean(item)),
    enabledCases: cases.filter((item) => item.enabled),
    batches,
    runs: runs.slice(0, 100),
    legacyRecords: { batches: allBatches.length - batches.length, runs: allRuns.length - runs.length, note: "旧评测器记录保留在本地文件中，但不混入当前运行时指标。" },
    latestBatch: latest ?? null,
    enabledSkills,
    evaluatorVersion: MODULE_EVALUATOR_VERSION,
    runtime: modelRuntime(),
  };
}

export function batchWithRuns(module: ProductModule, id: string) {
  const batch = getModuleBatch(id, module);
  if (!batch) return undefined;
  const runs = loadModuleRuns(module).filter((item) => batch.runIds.includes(item.id));
  return { batch, runs };
}

export function compareBatches(module: ProductModule, leftId: string, rightId: string) {
  const left = batchWithRuns(module, leftId);
  const right = batchWithRuns(module, rightId);
  if (!left || !right) return undefined;
  const comparable = left.batch.caseSetHash === right.batch.caseSetHash && left.batch.evaluatorVersion === right.batch.evaluatorVersion && left.batch.provider === right.batch.provider && left.batch.model === right.batch.model;
  const leftByCase = new Map(left.runs.map((run) => [run.caseId, run]));
  const rightByCase = new Map(right.runs.map((run) => [run.caseId, run]));
  const fixed: string[] = [];
  const regressions: string[] = [];
  const replyChanged: string[] = [];
  for (const caseId of new Set([...leftByCase.keys(), ...rightByCase.keys()])) {
    const before = leftByCase.get(caseId);
    const after = rightByCase.get(caseId);
    if (before?.status !== "PASS" && after?.status === "PASS") fixed.push(caseId);
    if (before?.status === "PASS" && after?.status !== "PASS") regressions.push(caseId);
    if (before && after && before.status === after.status && before.actual !== after.actual) replyChanged.push(caseId);
  }
  return { comparable, reason: comparable ? "运行条件一致，可比较。" : "用例快照、评测器、Provider 或模型不同，不可直接比较。", left: left.batch, right: right.batch, fixed, regressions, replyChanged };
}




