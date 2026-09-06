type SemanticConditionLike = { terms?: unknown };

const KNOWN_TOPICS = [
  "光子嫩肤",
  "超声炮",
  "热玛吉",
  "皮秒",
  "点阵",
  "玫瑰痤疮",
  "玫瑰皮肤",
  "晒斑",
  "雀斑",
] as const;

const SKIN_CONCERN_PATTERN = /玫瑰|晒斑|雀斑|敏感|痘|斑|皮肤较差|皮肤问题/;
const GENERIC_TERM_PATTERN = /^(?:医美|医美项目|护肤|素人|博主|达人|体验|日记|记录)$/;

function topicSearchPhrases(topic: string): string[] {
  if (SKIN_CONCERN_PATTERN.test(topic)) {
    return [
      `${topic} 改善 记录`,
      `${topic} 素人 分享`,
      `${topic} 皮肤 日记`,
      `${topic} 改善 前后`,
    ];
  }
  return [
    `${topic} 体验 日记`,
    `${topic} 素人 分享`,
    `${topic} 术后 恢复`,
    `${topic} 真实 测评`,
  ];
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, output);
}

function normalizedTopic(value: string): string[] {
  const known = KNOWN_TOPICS.filter((topic) => value.includes(topic));
  if (known.length) return [...known];
  return value
    .replace(/[（）()]/g, " ")
    .replace(/(?:等)?医美项目|皮肤较差的?|做过|有过|需要|类似的笔记/g, " ")
    .split(/[、/|，,；;]|\s{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 20 && !GENERIC_TERM_PATTERN.test(item));
}

/**
 * 将复杂自然语言条件拆成多路、偏个人经历的搜索词。
 * 搜索只负责扩大召回，粉丝/点赞/素人身份仍由后续硬过滤和语义判断负责。
 */
export function buildCreatorSearchKeywords(input: {
  query: string;
  fallbackKeyword: string;
  confirmedRule?: { semantic_conditions?: SemanticConditionLike[] } | null;
  structuredIntent?: unknown;
  maxKeywords?: number;
}): string[] {
  const rawTerms: string[] = [];
  for (const topic of KNOWN_TOPICS) if (input.query.includes(topic)) rawTerms.push(topic);
  for (const condition of input.confirmedRule?.semantic_conditions ?? []) collectStrings(condition.terms, rawTerms);

  if (input.structuredIntent && typeof input.structuredIntent === "object") {
    const intent = input.structuredIntent as Record<string, unknown>;
    for (const key of ["searchKeywords", "keywords", "semanticTerms", "semanticConditions", "semantic_conditions"]) {
      collectStrings(intent[key], rawTerms);
    }
  }

  const topics = Array.from(new Set(rawTerms.flatMap(normalizedTopic)));
  // 宽泛的“项目名 + 体验”结果通常被高粉账号占据。为千粉素人场景补充
  // 素人分享、皮肤日记和恢复过程等长尾表达，由后续硬过滤保证准确性。
  // Round-robin phrase variants so the first search wave covers different
  // treatments/skin concerns instead of spending all early pages on one topic.
  const phraseGroups = topics.map(topicSearchPhrases);
  const phrases = Array.from({ length: 4 }, (_, variantIndex) =>
    phraseGroups.map((group) => group[variantIndex]).filter(Boolean),
  ).flat();
  if (!phrases.length && input.fallbackKeyword.trim()) phrases.push(`${input.fallbackKeyword.trim()} 体验 日记`);
  return Array.from(new Set(phrases)).slice(0, Math.max(1, input.maxKeywords ?? 32));
}
