import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CreatorAgentRun, SkillDefinition, ToolDefinition } from "./skills/types.js";

const dataDir = join(process.cwd(), "agent", "data");
function readJson<T>(name: string, fallback: T): T {
  try { return JSON.parse(readFileSync(join(dataDir, name), "utf8")) as T; } catch { return fallback; }
}
function saveJson(name: string, value: unknown) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, name), JSON.stringify(value, null, 2), "utf8");
}

const defaults: SkillDefinition[] = [
  {
    id: "creator_intent_structuring", name: "达人检索意图结构化", kind: "llm",
    description: "把媒介专员的一句话需求拆成硬性条件、语义条件和排序偏好；批次人数由业务层固定为 20。",
    useWhen: ["用户输入自然语言找达人需求", "需要区分粉丝数等硬条件与内容语义条件"],
    notFor: ["不要用于判断具体达人是否命中", "不要用于审核广告法或企业规则"],
    requiredInputs: ["query"], outputContract: "JSON: hardFilters, semanticConditions, limit=20, ranking",
    prompt: "你是媒介助手的达人检索意图 Skill。将自然语言需求结构化为硬性数据条件和语义条件。批次目标固定返回 limit=20；不要用正则推断语义，不要补造用户没有说过的条件。只返回 JSON。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_search_strategy", name: "检索关键词与分页策略", kind: "code",
    description: "依据确认规则生成最多 32 路稳定的 RedFox 基础、长尾与宽召回词，并按持久化游标轮转分页。",
    useWhen: ["自然语言条件已经结构化", "需要覆盖医美项目、皮肤问题和个人经历表达"],
    notFor: ["不能绕过 RedFox 调用预算", "不能修改用户确认后的筛选条件"],
    requiredInputs: ["query", "confirmedRule", "cursor"], outputContract: "keywords, nextPageByKeyword, pageBudget",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_history_exclusion", name: "跨批次筛选历史排除", kind: "code",
    description: "读取同项目同条件的筛选历史，排除已采用、项目已有和冷却期内对象。",
    useWhen: ["首次检索需要回填历史任务", "继续检索或相同条件再次检索"],
    notFor: ["不能跨项目排除达人", "临时失败对象冷却结束后不能永久排除"],
    requiredInputs: ["projectId", "searchKey", "screeningHistory"], outputContract: "excludedCreatorIds, excludedNoteKeys",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_hard_filtering", name: "达人硬条件筛选", kind: "code",
    description: "按粉丝数、近 90 天点赞和活跃度等结构化条件先筛选，减少后续资料与模型调用。",
    useWhen: ["账号详情已返回", "规则包含粉丝数、近期点赞或活跃历史要求"],
    notFor: ["不能用总互动量代替点赞数", "字段缺失时不能伪造通过"],
    requiredInputs: ["profile", "confirmedRule", "representativeNote"], outputContract: "passed, reasonCode, fieldEvidence",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_note_evidence_selection", name: "代表笔记证据选择", kind: "code",
    description: "优先选择近期、高赞且包含个人体验信号的笔记，避免用无关作品判断达人。",
    useWhen: ["同一达人召回多篇笔记", "需要从作品列表补充近期点赞证据"],
    notFor: ["不能把搜索种子笔记复制成全部作品", "不能跨达人混用笔记"],
    requiredInputs: ["candidateNotes", "postedNotes"], outputContract: "representativeNote, selectionReasons",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_personal_account_assessment", name: "个人博主与机构识别", kind: "llm",
    description: "基于昵称、简介、主页内容和笔记语气，判断个人博主、机构门店或营销账号。",
    useWhen: ["检索要求素人或个人博主", "候选资料出现医院、机构、门店、官方等信号"],
    notFor: ["不能仅凭一个词武断判定", "证据不足必须返回 unknown", "不能推断非公开身份属性"],
    requiredInputs: ["query", "candidate"], outputContract: "JSON: accountAssessment {type, matched, confidence, evidence, uncertainties}",
    prompt: "判断候选是否符合个人博主/素人要求。结合昵称、简介和笔记证据，输出 accountAssessment：{type:personal|institution|marketing|unknown,matched,confidence,evidence,uncertainties}。机构、医院、门店、官方号不得因内容主题相似而判为个人；证据不足返回 unknown。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_experience_evidence", name: "本人经历证据识别", kind: "llm",
    description: "区分本人项目体验、皮肤困扰记录与科普转载、机构宣传或泛话题内容。",
    useWhen: ["条件包含做过、体验、日记、记录或具体皮肤困扰", "需要验证笔记是否能证明本人经历"],
    notFor: ["不能把科普或广告当作本人经历", "不能从图片推断医疗诊断"],
    requiredInputs: ["query", "candidate", "imageEvidence(optional)"], outputContract: "JSON: experienceEvidence {matched, confidence, evidence, uncertainties}",
    prompt: "判断公开内容是否能证明候选本人做过相关项目或本人存在相关皮肤困扰。输出 experienceEvidence：{matched,confidence,evidence,uncertainties}。科普转载、机构案例、商品推广和泛话题不等于本人经历；证据不足返回 unknown。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_semantic_matching", name: "达人语义匹配", kind: "llm",
    description: "依据达人简介、笔记文本、图片证据逐项判断是否满足检索条件。",
    useWhen: ["已有结构化检索条件和候选达人资料", "需要理解同义表达、经历描述或内容主题"],
    notFor: ["不能修改粉丝数、活跃度等原始数据", "不能替代人工最终选人", "没有证据时不得判定命中"],
    requiredInputs: ["structuredQuery", "candidate", "imageEvidence(optional)"], outputContract: "JSON: matched, confidence, evidence, reasons",
    prompt: "你是达人语义匹配 Skill。逐项判断检索条件是否被候选人的公开资料、笔记或图片证据支持。返回 matched、confidence、evidence、reasons；未知返回 unknown，不要输出最终总分。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_image_understanding", name: "达人图片内容理解", kind: "llm",
    description: "识别博主图文中的项目、肤质困扰、场景和图片可见文字，为语义匹配提供证据。",
    useWhen: ["候选达人有笔记图片 URL", "关键信息可能只出现在图片而非正文"],
    notFor: ["图片无法访问或分辨率不足时不得猜测", "不能识别人脸身份、医疗诊断或隐私属性", "不能把图片推测当作确定事实"],
    requiredInputs: ["imageUrls", "candidateContext"], outputContract: "JSON: topics, visibleText, evidence, uncertainties, confidence",
    prompt: "你是达人图片证据 Skill。只描述图片中明确可见的文字、项目、场景和内容主题，区分确定证据与不确定推测。不要做医疗诊断，不要推断隐私属性。只返回 JSON。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_evidence_summary", name: "达人证据摘要", kind: "llm",
    description: "把语义命中和图片证据整理成媒介专员可复核的简短说明。",
    useWhen: ["需要在候选列表展示命中依据", "需要给人工确认提供下一步核验建议"],
    notFor: ["不能新增输入中不存在的证据", "不能代替风险审核或法律意见"],
    requiredInputs: ["query", "candidateMatches", "imageEvidence(optional)"], outputContract: "JSON: summary, highlights, uncertainties, nextChecks",
    prompt: "你是达人证据摘要 Skill。只引用输入中的证据，明确区分已确认和待核验内容，返回 summary、highlights、uncertainties、nextChecks。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_ranking", name: "达人结果排序", kind: "code",
    description: "按模型匹配证据、活跃度和硬性数据进行确定性排序。",
    useWhen: ["语义匹配已经完成", "需要稳定、可解释地排序候选人"],
    notFor: ["不能自行理解自然语言", "不能覆盖硬性条件", "不能修改模型证据"],
    requiredInputs: ["candidates"], outputContract: "按 matchScore、activity、followers 排序的候选数组",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_continuation_control", name: "20 人批次续检控制", kind: "code",
    description: "根据有效人数、数据源游标和安全调用预算决定完成、部分完成或允许继续检索。",
    useWhen: ["每页候选处理完成", "批次达到 20 人或接近调用预算"],
    notFor: ["不能用固定 100 人候选池提前终止", "数据源未耗尽时不能错误标记不可继续"],
    requiredInputs: ["persistedCount", "batchTarget", "cursor", "sourceExhausted", "requestBudget"], outputContract: "status, canContinue, partialReason",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_intent_structuring", name: "审核要求结构化", kind: "llm",
    description: "把审核要求或脚本拆成宣传目标、禁用表达、必须核验的声明和输出格式。",
    useWhen: ["用户提交审核要求、脚本或品牌规则", "审核任务有额外的业务要求"],
    notFor: ["不能替代广告法和知识库检索", "不能自行创设企业规则", "没有审核要求时不应强行补充"],
    requiredInputs: ["title", "body", "requirements"], outputContract: "JSON: claims, prohibitedPatterns, requiredChecks, reviewScope",
    prompt: "你是内容审核要求结构化 Skill。提取文本中的宣传声明、绝对化表达、功效承诺、数据引用和用户指定检查项。只基于输入，不输出法律结论。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_claim_extraction", name: "宣传声明提取", kind: "llm",
    description: "从标题、正文和图片文字中提取功效、数据、引证、价格和用户评价声明。",
    useWhen: ["审核内容包含宣传文案", "需要建立声明到证据的核验清单"],
    notFor: ["不能把普通描述改写成更强声明", "不能直接输出法律结论"],
    requiredInputs: ["title", "body", "requirements"], outputContract: "JSON: claims {text,type,locator,requiresEvidence}",
    prompt: "从审核素材中提取明确宣传声明，输出 claims：[{text,type,locator,requiresEvidence}]。覆盖功效、医疗、数据、引证、价格、用户评价和绝对化表达；只提取原文存在的声明。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_knowledge_coverage", name: "知识覆盖评估", kind: "code",
    description: "检查广告法、私有规则、素材和声明所需证据是否齐全，生成覆盖警告。",
    useWhen: ["知识库检索和规则扫描完成", "需要判断能否给出低风险结论"],
    notFor: ["没有知识证据时不能默认覆盖完整", "不能隐藏私有规则缺失"],
    requiredInputs: ["knowledgeChunks", "requirements", "assetStatus"], outputContract: "coverageWarnings, coverageStatus",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_text_compliance", name: "文本合规语义审核", kind: "llm",
    description: "结合广告法知识片段和用户私有规则，对标题、正文和脚本中的声明做语义级风险判断。",
    useWhen: ["已有检索到的广告法或私有规则片段", "文本表达不是简单关键词命中，需要结合上下文判断"],
    notFor: ["不能脱离知识片段给出法律结论", "不能把模型判断当作律师意见", "不能修改原文或自动发布"],
    requiredInputs: ["content", "knowledgeChunks", "deterministicFindings"], outputContract: "JSON: findings, riskLevel, uncertainties, missingEvidence",
    prompt: "你是广告内容文本合规 Skill。只能依据提供的知识片段、确定性规则命中和原文上下文判断。输出 findings、riskLevel、uncertainties、missingEvidence；引用具体证据，不得虚构法条。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_evidence_grounding", name: "风险证据绑定", kind: "code",
    description: "将每个风险项绑定到原文位置、规则片段、知识库版本和置信度。",
    useWhen: ["确定性规则和文本语义审核均已返回", "准备保存审核发现"],
    notFor: ["无来源片段的模型判断不能伪造成有法条依据", "不能跨任务复用知识快照"],
    requiredInputs: ["findings", "knowledgeChunks", "content"], outputContract: "groundedFindings, unresolvedFindings",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_image_understanding", name: "审核图片内容理解", kind: "llm",
    description: "读取审核素材图片中的文字、前后对比、功效暗示和视觉承诺，补充人工复核线索。",
    useWhen: ["审核任务包含图片素材", "图片文字或视觉效果可能改变合规判断"],
    notFor: ["图片不可访问或模糊时不能猜测", "不能做医学诊断或判断真实疗效", "不能替代人工复核图片真实性"],
    requiredInputs: ["assetUrls", "contentContext", "knowledgeChunks"], outputContract: "JSON: extractedText, visualClaims, evidence, uncertainties, riskHints",
    prompt: "你是审核图片理解 Skill。只提取看得见的文字和视觉表达，标出前后对比、功效暗示、价格/数据声明，并列出无法确认的内容。不要做医学诊断。只返回 JSON。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_risk_decision", name: "审核风险决策", kind: "llm",
    description: "汇总确定性规则、文本语义、图片证据和知识库版本，生成可解释的风险分级与待确认项。",
    useWhen: ["文本、图片和知识证据已经完成", "需要输出整体风险和人工复核重点"],
    notFor: ["不能在没有证据时给出低风险结论", "不能替代法律顾问", "不能绕过覆盖警告"],
    requiredInputs: ["findings", "coverageWarnings", "knowledgeSnapshot", "requirements"], outputContract: "JSON: overallRisk, riskCounts, recommendedAction, rationale, humanReviewItems",
    prompt: "你是内容审核风险决策 Skill。综合输入证据和覆盖警告，输出 overallRisk、riskCounts、recommendedAction、rationale、humanReviewItems。证据不足时必须提高为 needs_confirmation，不得降低确定性高风险。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_risk_floor", name: "确定性风险下限保护", kind: "code",
    description: "代码比较模型建议与规则风险，禁止模型降低确定性高风险，并在覆盖不足时提升为待确认。",
    useWhen: ["模型风险决策返回后", "存在确定性规则或覆盖警告"],
    notFor: ["不能降低确定性规则风险", "不能把待确认自动改为低风险"],
    requiredInputs: ["proposedRisk", "deterministicFindings", "coverageWarnings"], outputContract: "overallRisk, rationale",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_rewrite_guidance", name: "合规改写建议", kind: "llm",
    description: "基于已确认风险和证据生成逐项、保守、可执行的改写方向。",
    useWhen: ["风险项已经完成证据绑定", "需要给内容人员提供修改动作"],
    notFor: ["不能承诺修改后必然合规", "不能删除或弱化未解决风险"],
    requiredInputs: ["findings", "decision", "originalContent"], outputContract: "JSON: rewriteGuidance {priority,original,suggestion,reason}",
    prompt: "依据输入中的风险项和证据生成 rewriteGuidance。每条包含 priority、original、suggestion、reason；保持原意但移除未经证实的承诺，不得宣称修改后必然合法合规。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "audit_review_summary", name: "审核人工复核摘要", kind: "llm",
    description: "将审核结果整理为审核员可逐项处理的修改建议和证据清单。",
    useWhen: ["审核完成后需要人工改稿", "存在 needs_confirmation 或图片待核验项"],
    notFor: ["不能自动确认事实", "不能替审核员签署最终结论", "不能删除风险证据"],
    requiredInputs: ["findings", "humanReviewItems", "originalContent"], outputContract: "JSON: prioritizedActions, evidenceChecklist, unresolvedQuestions",
    prompt: "你是人工复核摘要 Skill。按优先级整理修改动作、证据清单和未解决问题，只引用输入结果，不新增判断。",
    model: "gpt-5.6-sol", temperature: 0.1, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
  {
    id: "creator_evidence_grounding", name: "达人证据绑定", kind: "code",
    description: "将匹配结论绑定到具体笔记、主页、图片证据和采集时间后再写入项目。",
    useWhen: ["语义匹配已完成", "准备保存 creator_evidence 和 analysis_json"],
    notFor: ["不能保存输入中不存在的证据", "不能跨达人或跨笔记拼接依据"],
    requiredInputs: ["candidate", "representativeNote", "semanticMatch", "imageEvidence"], outputContract: "evidenceSummary, sourceUrl, capturedAt, confidence",
    prompt: "", model: "", temperature: 0, enabled: true, version: 1, updatedAt: new Date().toISOString(),
  },
];

const tools: ToolDefinition[] = [
  { id: "load_candidates", name: "加载候选达人", description: "读取小红书采集的候选达人数据。", enabled: true },
  { id: "dedupe_candidates", name: "达人去重", description: "按平台 ID、主页 URL 和账号标识确定性去重。", enabled: true },
  { id: "rank_candidates", name: "达人结果排序", description: "按匹配证据、活跃度和粉丝硬条件稳定排序。", enabled: true },
  { id: "persist_run", name: "记录 Agent 运行", description: "记录计划、步骤输入输出和运行状态。", enabled: true },
  { id: "redfox_search_notes", name: "RedFox 笔记搜索", description: "按关键词、页码和持久化游标读取真实小红书笔记。", enabled: true },
  { id: "redfox_account_detail", name: "RedFox 账号详情", description: "按需读取候选账号公开资料和粉丝数。", enabled: true },
  { id: "redfox_posted_notes", name: "RedFox 作品列表", description: "仅在近期点赞或活跃度证据不足时读取账号作品。", enabled: true },
  { id: "redfox_note_detail", name: "RedFox 笔记详情", description: "仅在搜索结果正文或图片不足时补查单篇笔记。", enabled: true },
  { id: "load_search_session", name: "读取检索会话", description: "读取相同项目和规则的分页游标与筛选历史。", enabled: true },
  { id: "save_search_progress", name: "保存检索进度", description: "保存分页游标、已处理笔记、达人和筛选原因。", enabled: true },
  { id: "persist_creator_result", name: "保存达人结果", description: "保存达人、项目关系、匹配证据和分析快照。", enabled: true },
  { id: "audit_retrieve_knowledge", name: "审核知识检索", description: "读取公共广告法和用户私有知识库片段及版本。", enabled: true },
  { id: "audit_deterministic_rule_scan", name: "审核确定性规则扫描", description: "执行已审核的广告法规则库，作为高风险兜底证据。", enabled: true },
  { id: "audit_load_assets", name: "加载审核素材", description: "读取审核任务图片素材和可用提取文本状态。", enabled: true },
  { id: "audit_persist_findings", name: "保存审核结果", description: "保存 findings、覆盖警告、知识快照和审核任务状态。", enabled: true },
  { id: "audit_persist_snapshots", name: "保存知识快照", description: "保存本次审核实际使用的公共与私有知识库版本。", enabled: true },
  { id: "audit_persist_coverage_warnings", name: "保存覆盖警告", description: "保存知识不足、图片不可读和模型未完成等复核提示。", enabled: true },
];

export function getSkills(): SkillDefinition[] {
  const stored = readJson<SkillDefinition[]>("skills.json", []);
  const byId = new Map(stored.map((item) => [item.id, item]));
  const merged = defaults.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }));
  if (JSON.stringify(merged) !== JSON.stringify(stored)) saveJson("skills.json", merged);
  return merged;
}
export function getSkill(id: string) { return getSkills().find((item) => item.id === id); }
export function patchSkill(id: string, patch: Partial<SkillDefinition>) {
  const next = getSkills().map((item) => item.id === id ? { ...item, ...patch, id, version: item.version + 1, updatedAt: new Date().toISOString() } : item);
  saveJson("skills.json", next);
  return next.find((item) => item.id === id);
}
export { tools };
export const getRuns = () => readJson<CreatorAgentRun[]>("runs.json", []);
export const putRun = (run: CreatorAgentRun) => { const next = [run, ...getRuns()].slice(0, 100); saveJson("runs.json", next); return run; };
