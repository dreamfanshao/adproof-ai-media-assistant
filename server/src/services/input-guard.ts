import { createHash } from "node:crypto";

export type GuardResult = { ok: true; normalized: string; matchedTerms: string[]; confidence: number } | { ok: false; code: "INPUT_OUT_OF_SCOPE" | "PROMPT_INJECTION" | "RATE_LIMITED" | "DUPLICATE_REQUEST"; message: string; retryAfterSeconds?: number; matchedTerms: string[]; confidence: number };

const creatorTerms = ["达人", "素人", "小红书", "粉丝", "活跃", "医美", "光子嫩肤", "水光针", "皮秒", "点阵", "超声炮", "热玛吉", "针清", "晒斑", "雀斑", "黄褐斑", "产后斑", "护肤", "笔记", "博主", "推广", "种草", "内容"];
const auditTerms = ["审核", "广告", "文案", "图文", "小红书", "合规", "发布", "脚本", "风险", "功效", "极限词", "医疗", "宣传", "达人", "素材", "标题", "正文", "祛斑", "效果"];
const injectionPatterns = [/ignore\s+(all|any|previous|prior)/i, /system\s+prompt/i, /jailbreak/i, /<script[\s>]/i, /javascript:/i, /data:text\/html/i, /union\s+select/i, /drop\s+table/i, /(?:bearer|api[_ -]?key|cookie)\s*[:=]/i, /将以上指令|忽略以上规则|绕过安全/i];

function normalize(value: string) { return value.normalize("NFKC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/\s+/g, " ").trim(); }

export function fingerprint(parts: string[]) { return createHash("sha256").update(parts.map(normalize).join("\u001f")).digest("hex"); }

export function validateInput(text: string, kind: "creator" | "audit"): GuardResult {
  const normalized = normalize(text);
  const terms = kind === "creator" ? creatorTerms : auditTerms;
  if (injectionPatterns.some((pattern) => pattern.test(normalized))) return { ok: false, code: "PROMPT_INJECTION", message: "输入包含疑似提示注入或脚本内容，已拦截；请只输入与达人检索或内容审核相关的业务要求。", matchedTerms: [], confidence: 0 };
  if (normalized.length < 3) return { ok: false, code: "INPUT_OUT_OF_SCOPE", message: "请输入更具体的业务要求。", matchedTerms: [], confidence: 0 };
  const matchedTerms = terms.filter((term) => normalized.includes(term));
  const confidence = Math.min(1, matchedTerms.length / 3);
  if (!matchedTerms.length) return { ok: false, code: "INPUT_OUT_OF_SCOPE", message: kind === "creator" ? "这段内容与达人检索无关，未调用后续数据或模型服务。请描述平台、粉丝、活跃度、内容主题或投放要求。" : "这段内容与内容审核无关，未调用后续模型服务。请提交待审核文案、图片或合规要求。", matchedTerms, confidence };
  return { ok: true, normalized, matchedTerms, confidence };
}

type Limit = { max: number; windowMs: number; duplicateWindowMs?: number };
const buckets = new Map<string, number[]>();
const recent = new Map<string, number>();

export function enforceRequestLimit(scope: string, userId: string, requestFingerprint: string, limit: Limit): GuardResult {
  const now = Date.now();
  const key = `${scope}:${userId}`;
  const timestamps = (buckets.get(key) ?? []).filter((value) => now - value < limit.windowMs);
  const duplicateKey = `${key}:${requestFingerprint}`;
  if (limit.duplicateWindowMs && now - (recent.get(duplicateKey) ?? 0) < limit.duplicateWindowMs) return { ok: false, code: "DUPLICATE_REQUEST", message: "相同请求正在处理或刚刚已提交，请稍后查看已有结果，避免重复消耗服务额度。", retryAfterSeconds: Math.max(1, Math.ceil((limit.duplicateWindowMs - (now - (recent.get(duplicateKey) ?? now))) / 1000)), matchedTerms: [], confidence: 1 };
  if (timestamps.length >= limit.max) return { ok: false, code: "RATE_LIMITED", message: "请求过于频繁，请稍后再试。为保护模型和数据源额度，请勿连续重复提交。", retryAfterSeconds: Math.max(1, Math.ceil((limit.windowMs - (now - timestamps[0])) / 1000)), matchedTerms: [], confidence: 1 };
  timestamps.push(now); buckets.set(key, timestamps); recent.set(duplicateKey, now);
  return { ok: true, normalized: "", matchedTerms: [], confidence: 1 };
}
