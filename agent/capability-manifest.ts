export type RuntimeModule = "creators" | "audit";
export type RuntimeCapability = {
  id: string;
  capabilityType: "skill" | "tool";
  purpose: string;
  optional?: boolean;
};

export const CREATOR_CANDIDATE_AGENT_PIPELINE: RuntimeCapability[] = [
  { id: "load_candidates", capabilityType: "tool", purpose: "加载当前候选资料" },
  { id: "dedupe_candidates", capabilityType: "tool", purpose: "按平台账号去重" },
  { id: "creator_image_understanding", capabilityType: "skill", purpose: "提取笔记图片证据", optional: true },
  { id: "creator_personal_account_assessment", capabilityType: "skill", purpose: "判断个人博主或机构账号" },
  { id: "creator_experience_evidence", capabilityType: "skill", purpose: "识别本人体验与营销转述" },
  { id: "creator_semantic_matching", capabilityType: "skill", purpose: "逐项完成语义匹配" },
  { id: "rank_candidates", capabilityType: "tool", purpose: "按证据和活跃度稳定排序" },
  { id: "creator_evidence_summary", capabilityType: "skill", purpose: "生成可复核证据摘要", optional: true },
  { id: "persist_run", capabilityType: "tool", purpose: "记录 Agent Trace" },
];

export const CREATOR_PRODUCTION_PIPELINE: RuntimeCapability[] = [
  { id: "creator_intent_structuring", capabilityType: "skill", purpose: "结构化自然语言检索条件" },
  { id: "creator_search_strategy", capabilityType: "skill", purpose: "生成 RedFox 多关键词轮转计划" },
  { id: "load_search_session", capabilityType: "tool", purpose: "读取同条件检索游标与筛选历史" },
  { id: "creator_history_exclusion", capabilityType: "skill", purpose: "排除已采用、已看过和冷却期对象" },
  { id: "redfox_search_notes", capabilityType: "tool", purpose: "按关键词和游标逐页召回笔记" },
  { id: "dedupe_candidates", capabilityType: "tool", purpose: "按平台账号和笔记去重" },
  { id: "redfox_account_detail", capabilityType: "tool", purpose: "按需读取账号详情" },
  { id: "creator_hard_filtering", capabilityType: "skill", purpose: "执行粉丝数、近期点赞和活跃度硬筛选" },
  { id: "redfox_posted_notes", capabilityType: "tool", purpose: "仅在硬条件需要时读取作品列表", optional: true },
  { id: "creator_note_evidence_selection", capabilityType: "skill", purpose: "选择近期高赞且具个人体验信号的代表笔记" },
  { id: "redfox_note_detail", capabilityType: "tool", purpose: "仅在搜索结果证据不足时补查笔记详情", optional: true },
  { id: "creator_image_understanding", capabilityType: "skill", purpose: "提取可见图片证据", optional: true },
  { id: "creator_personal_account_assessment", capabilityType: "skill", purpose: "排除机构、门店和营销号" },
  { id: "creator_experience_evidence", capabilityType: "skill", purpose: "判断是否为本人真实经历或皮肤困扰" },
  { id: "creator_semantic_matching", capabilityType: "skill", purpose: "根据文本与图片证据判定条件命中" },
  { id: "creator_ranking", capabilityType: "skill", purpose: "按证据、活跃度和数据完整度排序" },
  { id: "creator_evidence_grounding", capabilityType: "skill", purpose: "将结论绑定到具体笔记与采集证据" },
  { id: "persist_creator_result", capabilityType: "tool", purpose: "保存达人、项目关系和证据" },
  { id: "creator_continuation_control", capabilityType: "skill", purpose: "判断达到 20 人、数据源耗尽或可继续" },
  { id: "save_search_progress", capabilityType: "tool", purpose: "保存分页游标与筛选历史" },
];

export const AUDIT_PRODUCTION_PIPELINE: RuntimeCapability[] = [
  { id: "audit_retrieve_knowledge", capabilityType: "tool", purpose: "读取广告法与私有知识库证据" },
  { id: "audit_deterministic_rule_scan", capabilityType: "tool", purpose: "执行确定性规则扫描" },
  { id: "audit_knowledge_coverage", capabilityType: "skill", purpose: "判断知识覆盖缺口" },
  { id: "audit_intent_structuring", capabilityType: "skill", purpose: "结构化审核范围与要求" },
  { id: "audit_claim_extraction", capabilityType: "skill", purpose: "提取功效、数据和引证声明" },
  { id: "audit_load_assets", capabilityType: "tool", purpose: "读取审核图片素材", optional: true },
  { id: "audit_image_understanding", capabilityType: "skill", purpose: "提取图片文字和视觉承诺", optional: true },
  { id: "audit_text_compliance", capabilityType: "skill", purpose: "结合上下文判断文本风险" },
  { id: "audit_evidence_grounding", capabilityType: "skill", purpose: "将风险项绑定到规则与知识片段" },
  { id: "audit_risk_decision", capabilityType: "skill", purpose: "汇总整体风险和人工复核项" },
  { id: "audit_risk_floor", capabilityType: "skill", purpose: "阻止模型降低确定性规则风险" },
  { id: "audit_rewrite_guidance", capabilityType: "skill", purpose: "生成逐项修改建议" },
  { id: "audit_review_summary", capabilityType: "skill", purpose: "整理人工复核摘要" },
  { id: "audit_persist_findings", capabilityType: "tool", purpose: "保存审核发现" },
  { id: "audit_persist_snapshots", capabilityType: "tool", purpose: "保存知识库版本快照" },
  { id: "audit_persist_coverage_warnings", capabilityType: "tool", purpose: "保存覆盖警告" },
];

export const pipelineFor = (module: RuntimeModule): RuntimeCapability[] =>
  module === "creators" ? CREATOR_PRODUCTION_PIPELINE : AUDIT_PRODUCTION_PIPELINE;

export const defaultMandatorySkills = (module: RuntimeModule): string[] =>
  module === "creators"
    ? [
        "creator_intent_structuring",
        "creator_history_exclusion",
        "creator_hard_filtering",
        "creator_personal_account_assessment",
        "creator_experience_evidence",
        "creator_semantic_matching",
        "creator_evidence_grounding",
        "creator_continuation_control",
      ]
    : [
        "audit_knowledge_coverage",
        "audit_intent_structuring",
        "audit_claim_extraction",
        "audit_text_compliance",
        "audit_evidence_grounding",
        "audit_risk_decision",
        "audit_risk_floor",
        "audit_review_summary",
      ];

export const defaultToolGroups = (module: RuntimeModule): Record<string, string[]> =>
  module === "creators"
    ? {
        "RedFox 数据读取": ["redfox_search_notes", "redfox_account_detail", "redfox_posted_notes", "redfox_note_detail"],
        "检索状态": ["load_search_session", "save_search_progress"],
        "去重与落库": ["dedupe_candidates", "rank_candidates", "persist_creator_result", "persist_run"],
      }
    : {
        "规则与素材读取": ["audit_retrieve_knowledge", "audit_deterministic_rule_scan", "audit_load_assets"],
        "审核结果沉淀": ["audit_persist_findings", "audit_persist_snapshots", "audit_persist_coverage_warnings"],
      };
