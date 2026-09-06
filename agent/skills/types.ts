export type SkillKind = "llm" | "code";
export type SkillDefinition = { id: string; name: string; description: string; useWhen: string[]; notFor: string[]; requiredInputs?: string[]; outputContract?: string; kind: SkillKind; prompt: string; model: string; temperature: number; enabled: boolean; version: number; updatedAt: string };
export type ToolDefinition = { id: string; name: string; description: string; enabled: boolean };
export type PlanStep = { id: string; capabilityType: "skill" | "tool"; capabilityId: string; purpose: string };
export type AgentPlan = { planner: "llm" | "deterministic-fallback"; steps: PlanStep[]; note?: string };
export type AgentStepLog = { id: string; capabilityType: "skill" | "tool"; capabilityId: string; startedAt: string; finishedAt: string; status: "completed" | "pending_llm" | "error"; input: unknown; output: unknown; note?: string };
export type CreatorCandidate = { id: string; nickname: string; handle?: string; profileUrl?: string; followers?: number; activity?: number; bio?: string; posts?: unknown[]; imageUrls?: string[]; source?: string; matchScore?: number; semanticMatch?: unknown; imageEvidence?: unknown };
export type CreatorAgentRun = { id: string; createdAt: string; query: string; plan: AgentPlan; steps: AgentStepLog[]; structuredQuery: unknown; candidates: CreatorCandidate[]; summary: unknown; status: "scored" | "pending_llm" | "partial"; disclaimer: string };
