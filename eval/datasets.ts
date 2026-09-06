// 本地 Eval 数据集（D005：仅本地运行，不部署、不作为线上功能）
// rule_parse：自然语言检索规则解析黄金集
export interface RuleParseCase {
  id: string;
  input: string;
  expect: {
    followers?: { operator: string; value: number };
    semanticTerms?: string[];
    rankingField?: string;
    limit?: number;
    ambiguities?: number; // 期望歧义条数
  };
  note?: string;
}

export const RULE_PARSE_CASES: RuleParseCase[] = [
  {
    id: "rp-01",
    input: "粉丝小于1500、活跃度较高、做过光子嫩肤",
    expect: { followers: { operator: "lt", value: 1500 }, semanticTerms: ["光子嫩肤"], rankingField: "activity", limit: 50 },
  },
  {
    id: "rp-02",
    input: "粉丝小于1500，做过光子嫩肤或有雀斑困扰，默认返回50人",
    expect: { followers: { operator: "lt", value: 1500 }, semanticTerms: ["光子嫩肤", "雀斑"], limit: 50 },
  },
  {
    id: "rp-03",
    input: "粉丝超过5000的医美达人",
    expect: { followers: { operator: "gt", value: 5000 }, semanticTerms: ["医美达人"] },
  },
  {
    id: "rp-04",
    input: "粉丝不超过1000",
    expect: { followers: { operator: "lte", value: 1000 } },
  },
  {
    id: "rp-05",
    input: "粉丝在1000到2000之间",
    expect: { ambiguities: 1 },
    note: "区间条件应进入 ambiguities（不能静默丢弃边界）",
  },
  {
    id: "rp-06",
    input: "活跃度较高，30人",
    expect: { rankingField: "activity", limit: 30 },
  },
  {
    id: "rp-07",
    input: "粉丝<1500、活跃度较高、做过光子嫩肤或有雀斑困扰",
    expect: { followers: { operator: "lt", value: 1500 }, semanticTerms: ["光子嫩肤", "雀斑"], rankingField: "activity" },
  },
  {
    id: "rp-08",
    input: "粉丝等于800的宝妈",
    expect: { followers: { operator: "eq", value: 800 }, semanticTerms: ["宝妈"] },
  },
  {
    id: "rp-09",
    input: "不要医美达人，粉丝小于2000",
    expect: { followers: { operator: "lt", value: 2000 }, semanticTerms: ["医美达人"] },
    note: "已知局限：当前解析器不处理否定词（“不要”），语义词仍被提取",
  },
  {
    id: "rp-10",
    input: "做过水光针、皮秒、点阵",
    expect: { semanticTerms: ["水光针", "皮秒", "点阵"] },
  },
];

// audit_rules：审核规则召回标注集（positive=应命中该规则；negative=不应命中）
export interface AuditRuleCase {
  id: string;
  text: string;
  expectRule: string; // 期望命中的规则 id；none 表示不应命中任何规则
  note?: string;
}

export const AUDIT_RULE_CASES: AuditRuleCase[] = [
  { id: "ar-01", text: "全网最低价，买到就是赚到！", expectRule: "absolute-term" },
  { id: "ar-02", text: "国家级认证，质量有保障。", expectRule: "absolute-term" },
  { id: "ar-03", text: "这是史上最好用的面霜，100% 有效。", expectRule: "absolute-term" },
  { id: "ar-04", text: "一针见效，根治色斑，无副作用。", expectRule: "medical-claim" },
  { id: "ar-05", text: "三天见效，彻底解决晒斑问题。", expectRule: "medical-claim" },
  { id: "ar-06", text: "研究显示，超过 90% 的用户感到满意。", expectRule: "unverified-citation" },
  { id: "ar-07", text: "好评返现 5 元，加微信领取。", expectRule: "fake-review" },
  { id: "ar-08", text: "今天天气很好，适合出门散步。", expectRule: "none" },
  { id: "ar-09", text: "这个杯子容量 500ml，做工精细。", expectRule: "none" },
  { id: "ar-10", text: "使用感受因人而异，仅代表个人体验。", expectRule: "none" },
  { id: "ar-11", text: "顶级品牌，全网第一的销量。", expectRule: "absolute-term" },
  { id: "ar-12", text: "有效率高达 99%，药到病除。", expectRule: "medical-claim" },
];

// semantic_match：达人语义匹配标注集（从真实检索结果抽取的样例；creator 字段从库加载）
export interface SemanticMatchCase {
  id: string;
  queryTerms: string[]; // 语义条件 terms
  match: "any" | "all" | "none";
  expectMatchedCreatorIds: string[]; // 预期命中的 platform_creator_id（前 4 位匹配）
  note?: string;
}

export const SEMANTIC_MATCH_CASES: SemanticMatchCase[] = [
  {
    id: "sm-01",
    queryTerms: ["光子嫩肤", "医美"],
    match: "any",
    expectMatchedCreatorIds: [],
    note: "预期：命中笔记含“光子嫩肤/医美”的达人（如白日做梦师等）；结果按 heuristic 判定为准并人工复核标注",
  },
  {
    id: "sm-02",
    queryTerms: ["雀斑", "晒斑", "斑点"],
    match: "any",
    expectMatchedCreatorIds: [],
    note: "同上；需人工标注真实命中集合后回填 expectMatchedCreatorIds",
  },
];
