import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ModelProvider = "openai-compatible" | "deepseek" | "qwen" | "custom";
export type ModelRoute = {
  provider: ModelProvider;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  supportsVision: boolean;
};
export type ModelConfig = {
  text: ModelRoute;
  vision: ModelRoute;
  planner: { temperature: number; maxTokens: number };
  visionFallbackEnabled: boolean;
  updatedAt: string;
};

const configPath = join(process.cwd(), "agent", "data", "model-config.json");
const DEFAULT_CONFIG: ModelConfig = {
  text: { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-sol", apiKeyEnv: "OPENAI_API_KEY", supportsVision: false },
  vision: { provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-vl-plus", apiKeyEnv: "DASHSCOPE_API_KEY", supportsVision: true },
  planner: { temperature: 0, maxTokens: 1800 },
  visionFallbackEnabled: true,
  updatedAt: new Date().toISOString(),
};

export const MODEL_PRESETS: Record<ModelProvider, Omit<ModelRoute, "apiKeyEnv"> & { apiKeyEnv: string }> = {
  "openai-compatible": { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-sol", apiKeyEnv: "OPENAI_API_KEY", supportsVision: true },
  deepseek: { provider: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY", supportsVision: false },
  qwen: { provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiKeyEnv: "DASHSCOPE_API_KEY", supportsVision: true },
  custom: { provider: "custom", baseUrl: "", model: "", apiKeyEnv: "OPENAI_API_KEY", supportsVision: false },
};

function safePlanner(value: Partial<ModelConfig["planner"]> | undefined, fallback = DEFAULT_CONFIG.planner): ModelConfig["planner"] {
  return {
    temperature: Math.max(0, Math.min(2, Number(value?.temperature ?? fallback.temperature) || 0)),
    maxTokens: Math.max(200, Math.min(16_000, Number(value?.maxTokens ?? fallback.maxTokens) || 1800)),
  };
}
function read(): ModelConfig {
  try {
    const stored = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ModelConfig>;
    return { ...DEFAULT_CONFIG, ...stored, planner: safePlanner(stored.planner) } as ModelConfig;
  } catch { return DEFAULT_CONFIG; }
}
function safeRoute(route: Partial<ModelRoute> | undefined, fallback: ModelRoute): ModelRoute {
  const next = { ...fallback, ...(route ?? {}) };
  if (!next.baseUrl || !/^https?:\/\//i.test(next.baseUrl)) throw new Error("模型 Base URL 必须是 http(s) 地址");
  if (!next.model.trim()) throw new Error("模型名称不能为空");
  if (!/^[A-Z][A-Z0-9_]*$/.test(next.apiKeyEnv)) throw new Error("API Key 环境变量名格式不正确");
  return { ...next, baseUrl: next.baseUrl.replace(/\/$/, ""), model: next.model.trim(), apiKeyEnv: next.apiKeyEnv.trim() };
}
export function getModelConfig(): ModelConfig { return read(); }
export function saveModelConfig(input: Partial<ModelConfig>): ModelConfig {
  const current = read();
  const next: ModelConfig = {
    text: safeRoute(input.text, current.text),
    vision: safeRoute(input.vision, current.vision),
    planner: safePlanner(input.planner, current.planner),
    visionFallbackEnabled: input.visionFallbackEnabled ?? current.visionFallbackEnabled,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(join(process.cwd(), "agent", "data"), { recursive: true });
  const temp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
  renameSync(temp, configPath);
  return next;
}
export function routeFor(input: { images?: string[]; model?: string }): { route: ModelRoute; fallbackUsed: boolean } {
  const config = read();
  if (!input.images?.length) return { route: input.model ? { ...config.text, model: input.model } : config.text, fallbackUsed: false };
  if (config.vision.supportsVision) return { route: input.model ? { ...config.vision, model: input.model } : config.vision, fallbackUsed: false };
  if (config.visionFallbackEnabled && config.text.supportsVision) return { route: config.text, fallbackUsed: true };
  throw new Error("当前视觉模型不支持图片，且未配置可用的视觉备用模型");
}
export function providerStatus(): Record<string, unknown> {
  const config = read();
  const check = (route: ModelRoute) => ({ provider: route.provider, model: route.model, apiKeyEnv: route.apiKeyEnv, configured: Boolean(process.env[route.apiKeyEnv]), supportsVision: route.supportsVision });
  return { text: check(config.text), vision: check(config.vision), visionFallbackEnabled: config.visionFallbackEnabled, updatedAt: config.updatedAt };
}
