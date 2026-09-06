// T08 Phase 3｜广告法规则匹配 v1（确定性规则库；LLM 语义分析留接口）
// 原则：保守防误报；命中即给风险项 + 依据条款 + 建议；overall_risk 由代码合成。
export interface AuditRule {
  id: string;
  category: string;
  riskLevel: "high" | "medium" | "low";
  pattern: RegExp;
  lawRef: string;
  lawExcerpt: string;
  suggestion: string;
  confidence: number;
}

export const AUDIT_RULES: AuditRule[] = [
  {
    id: "absolute-term",
    category: "绝对化用语",
    riskLevel: "high",
    pattern: /国家级|最高级|最佳|顶级|全网最低|全网第一|第一品牌|唯一|绝对|100%|百分百|史上最|全球首款|万能/,
    lawRef: "第九条",
    lawExcerpt: "广告不得使用\"国家级\"、\"最高级\"、\"最佳\"等用语。",
    suggestion: "删除绝对化用语（如\"最\"\"第一\"\"顶级\"），改为可验证的客观表述。",
    confidence: 0.9,
  },
  {
    id: "medical-claim",
    category: "医疗功效断言",
    riskLevel: "high",
    pattern: /治愈|根治|康复|疗效|有效率|无副作用|包治|药到病除|一针见效|三天见效|彻底.*(斑|痘|纹)|根除/,
    lawRef: "第十六条/第十七条",
    lawExcerpt: "医疗、药品、医疗器械广告不得含有表示功效、安全性的断言或者保证；除医疗、药品、医疗器械广告外，禁止其他任何广告涉及疾病治疗功能。",
    suggestion: "删除功效断言与治愈承诺；医疗功效表述须有批准依据，普通商品不得使用医疗用语。",
    confidence: 0.9,
  },
  {
    id: "unverified-citation",
    category: "引证内容无出处",
    riskLevel: "medium",
    pattern: /研究显示|研究表明|专家证明|临床证明|实验证明|数据表明|检测报告(?!附)|第三方认证(?!材料)/,
    lawRef: "第十一条",
    lawExcerpt: "广告使用数据、统计资料、调查结果、文摘、引用语等引证内容的，应当真实、准确，并表明出处。",
    suggestion: "补充数据/研究的确切出处、适用范围与有效期限，或删除无法出证的表述。",
    confidence: 0.75,
  },
  {
    id: "fake-review",
    category: "虚构用户评价",
    riskLevel: "medium",
    pattern: /好评返现|刷单|虚构.*评价|买家秀.*(伪造|虚构)/,
    lawRef: "第二十八条",
    lawExcerpt: "广告以虚假或者引人误解的内容欺骗、误导消费者的，构成虚假广告；虚构使用商品或者接受服务的效果的，属于虚假广告。",
    suggestion: "删除虚构评价/返现引导，用户评价须为真实体验。",
    confidence: 0.8,
  },
];
