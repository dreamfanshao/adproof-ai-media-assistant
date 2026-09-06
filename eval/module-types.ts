export type ProductModule = "creators" | "audit";

export type ModuleEvalStatus = "PASS" | "FAIL" | "REVIEW" | "ERROR";

export interface ModuleEvalCase {
  id: string;
  module: ProductModule;
  dataSource?: "redfox" | "fixture" | "advertising-law";
  analysisMode?: "multimodal" | "caption_only" | "text_rules";
  name: string;
  question: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  riskLevel: "low" | "medium" | "high";
  expectedBehavior: string[];
  expectedKeywords: { all?: string[]; any?: string[] };
  expectedReply?: string;
  expectedPrice?: number;
  expectedRiskPassed?: boolean;
  /** 达人检索至少需要落库的结果数；不足时标记 REVIEW，而不是误判为 PASS。 */
  minimumPersistedCount?: number;
  llmJudgePrompt?: string;
  tags?: string[];
  sourceRunId?: string;
  forbiddenWords: string[];
  expectedRisk?: "low" | "medium" | "high" | "needs_confirmation";
  requiredCapabilities: string[];
  forbiddenCapabilities: string[];
  evalDimensions: string[];
  enabled: boolean;
  source: "seed" | "manual" | "run";
  fixture?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleEvalRun {
  id: string;
  module: ProductModule;
  dataSource?: "redfox" | "fixture" | "advertising-law";
  analysisMode?: "multimodal" | "caption_only" | "text_rules";
  caseId: string;
  question: string;
  status: ModuleEvalStatus;
  passed: boolean;
  reason: string;
  actual: string;
  evidence: string[];
  keywordHits: string[];
  keywordMisses: string[];
  forbiddenHits: string[];
  capabilityHits: string[];
  capabilityMisses: string[];
  riskIssues: string[];
  agentStatus: string;
  agentRunId: string;
  trace: unknown[];
  provider: string;
  model: string;
  evaluatorVersion: string;
  durationMs: number;
  createdAt: string;
  error?: string;
}

export interface ModuleEvalBatch {
  id: string;
  module: ProductModule;
  dataSource?: "redfox" | "fixture" | "advertising-law";
  analysisMode?: "multimodal" | "caption_only" | "text_rules";
  name: string;
  versionLabel: string;
  changeNote: string;
  caseIds: string[];
  caseSnapshot: ModuleEvalCase[];
  caseSetHash: string;
  evaluatorVersion: string;
  provider: string;
  model: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  currentIndex: number;
  total: number;
  passed: number;
  failed: number;
  review: number;
  errors: number;
  runIds: string[];
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string;
}
