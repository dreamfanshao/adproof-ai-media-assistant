import { ApiError } from "../errors.js";
import type { ModelProviderId } from "./model-settings-service.js";

export interface AvailableModel {
  id: string;
  name: string;
}

export interface ModelProviderDefinition {
  id: ModelProviderId;
  name: string;
  shortName: string;
  baseUrl: string;
  defaultModel: string;
  models: AvailableModel[];
}

export const MODEL_PROVIDERS: readonly ModelProviderDefinition[] = [
  {
    id: "anthropic", name: "Claude (Anthropic)", shortName: "Claude", baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-5",
    models: [
      { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
      { id: "claude-opus-5", name: "Claude Opus 5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "openai", name: "ChatGPT (OpenAI)", shortName: "ChatGPT", baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.6-terra",
    models: [
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    ],
  },
  {
    id: "deepseek", name: "DeepSeek", shortName: "DeepSeek", baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-flash",
    models: [
      { id: "deepseek-flash", name: "DeepSeek V4.1 Flash" },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ],
  },
  {
    id: "qwen", name: "通义千问 (Qwen)", shortName: "Qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen3.8-flash",
    models: [
      { id: "qwen3.8-flash", name: "Qwen 3.8 Flash" },
      { id: "qwen3.8-max", name: "Qwen 3.8 Max" },
      { id: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
      { id: "qwen-plus", name: "Qwen Plus" },
    ],
  },
  {
    id: "glm", name: "智谱 GLM", shortName: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-5.2",
    models: [
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-5.1", name: "GLM-5.1" },
      { id: "glm-5-turbo", name: "GLM-5 Turbo" },
      { id: "glm-4.7", name: "GLM-4.7" },
      { id: "glm-4.7-flash", name: "GLM-4.7 Flash" },
    ],
  },
] as const;

export function modelProvider(provider: ModelProviderId): ModelProviderDefinition {
  const found = MODEL_PROVIDERS.find((item) => item.id === provider);
  if (!found) throw new ApiError(400, "MODEL_PROVIDER_UNSUPPORTED", "暂不支持该模型服务商。", false);
  return found;
}

export function modelIdMatchesProvider(provider: ModelProviderId, id: string): boolean {
  if (provider === "anthropic") return id.startsWith("claude-");
  if (provider === "openai") return /^(gpt-|chatgpt-|o\d)/i.test(id) && !/(audio|realtime|transcribe|tts|image|search)/i.test(id);
  if (provider === "deepseek") return id.startsWith("deepseek-");
  if (provider === "qwen") return id.startsWith("qwen") && !/(embedding|rerank|image|audio|tts)/i.test(id);
  return id.startsWith("glm-");
}

function cleanModels(provider: ModelProviderId, models: AvailableModel[]): AvailableModel[] {
  const seen = new Set<string>();
  return models
    .filter((item) => item.id && modelIdMatchesProvider(provider, item.id) && !seen.has(item.id) && seen.add(item.id))
    .slice(0, 200);
}

function modelListRequest(providerId: ModelProviderId, apiKey: string): { url: string; headers: Record<string, string> } {
  if (providerId === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models?limit=1000",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", Accept: "application/json" },
    };
  }
  if (providerId === "qwen") {
    return {
      url: "https://dashscope.aliyuncs.com/api/v1/models?providers=qwen&capabilities=TG&page_no=1&page_size=200",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    };
  }
  const provider = modelProvider(providerId);
  return {
    url: `${provider.baseUrl}/models`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  };
}

function parseModelList(providerId: ModelProviderId, payload: any): AvailableModel[] {
  const source = providerId === "qwen" ? payload.output?.models : payload.data;
  if (!Array.isArray(source)) {
    throw new ApiError(502, "MODEL_PROVIDER_INVALID_RESPONSE", "服务商返回了无法识别的模型列表。", true);
  }
  const raw = source.map((item: any) => {
    const id = providerId === "qwen" ? item?.model : item?.id;
    const name = providerId === "qwen" ? item?.name : item?.display_name;
    return { id: String(id ?? ""), name: String(name ?? id ?? "") };
  });
  const models = cleanModels(providerId, raw);
  if (models.length === 0) {
    throw new ApiError(502, "MODEL_PROVIDER_EMPTY_LIST", "服务商没有返回可用于当前任务的模型，请检查 API Key 权限或稍后重试。", true);
  }
  return models;
}

function providerError(status: number, operation: "list" | "test"): ApiError {
  let hint: string;
  if (status === 401 || status === 403) hint = "API Key 无效或没有访问权限。";
  else if (status === 402) hint = "服务商账号余额不足，请充值后重试。";
  else if (status === 429) hint = "服务商请求过于频繁，请稍后重试。";
  else if (operation === "test" && (status === 400 || status === 404)) hint = "服务商拒绝了所选模型，请确认该模型已对当前账号开放。";
  else hint = operation === "list" ? "服务商暂时无法返回模型列表。" : "服务商暂时无法完成模型连接测试。";
  return new ApiError(status === 429 ? 429 : 502, "MODEL_PROVIDER_REQUEST_FAILED", hint, status >= 500 || status === 429, {
    providerStatus: status,
  });
}

export class ModelProviderClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async list(providerId: ModelProviderId, apiKey: string): Promise<AvailableModel[]> {
    const { url, headers } = modelListRequest(providerId, apiKey);
    const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    if (!response.ok) throw providerError(response.status, "list");
    let payload: any;
    try { payload = JSON.parse(text); } catch { throw new ApiError(502, "MODEL_PROVIDER_INVALID_RESPONSE", "服务商返回了无法识别的模型列表。", true); }

    return parseModelList(providerId, payload);
  }

  async test(providerId: ModelProviderId, modelId: string, apiKey: string): Promise<void> {
    const provider = modelProvider(providerId);
    const anthropic = providerId === "anthropic";
    const openai = providerId === "openai";
    const endpoint = `${provider.baseUrl}${anthropic ? "/messages" : openai ? "/responses" : "/chat/completions"}`;
    const body = anthropic
      ? { model: modelId, max_tokens: 1, messages: [{ role: "user", content: "Reply with OK." }] }
      : openai
        ? { model: modelId, max_output_tokens: 16, input: "Reply with OK." }
        : { model: modelId, messages: [{ role: "user", content: "Reply with OK." }], max_tokens: 1, stream: false };
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: anthropic
        ? { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    await response.text();
    if (!response.ok) throw providerError(response.status, "test");
  }
}
