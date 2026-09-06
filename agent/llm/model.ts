import { providerStatus, routeFor } from "../model-config.js";
import { recordApiLog, recordUsageEvent } from "../../server/src/services/usage-analytics.js";

export type ModelResult = {
  status: "scored" | "pending_llm" | "error";
  data?: unknown;
  model: string;
  note?: string;
  provider?: string;
  fallbackUsed?: boolean;
};

export function llmReady() {
  return Object.values(providerStatus()).some((value: any) => value?.configured === true);
}

function decode(value: string) {
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(text); } catch { /* continue with a bounded extraction */ }
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  throw new Error("LLM returned non-JSON");
}

function timeoutMs() {
  const value = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(value) ? Math.max(5_000, Math.min(value, 120_000)) : 30_000;
}

function ensureJsonPrompt(system: string): string {
  // DeepSeek and several OpenAI-compatible providers require the word JSON when response_format=json_object is used.
  return /\bjson\b/i.test(system) ? system : `${system}\nReturn valid JSON only. Do not include markdown fences.`;
}

export function shouldRetryWithoutImages(status: number, responseText: string): boolean {
  return status === 400 && /failed to download image|image(?:_url)?[^\n]{0,80}(?:download|fetch)/i.test(responseText);
}

async function retryTextOnly(
  input: { system: string; prompt: string; images?: string[]; model?: string; temperature?: number; maxTokens?: number },
  reason: string,
): Promise<ModelResult> {
  const fallback = await model({ ...input, images: undefined });
  return {
    ...fallback,
    fallbackUsed: true,
    note: fallback.status === "scored" ? reason : fallback.note,
  };
}

export async function model(input: { system: string; prompt: string; images?: string[]; model?: string; temperature?: number; maxTokens?: number }): Promise<ModelResult> {
  let selected: ReturnType<typeof routeFor>;
  try {
    selected = routeFor(input);
  } catch (error) {
    return { status: "error", model: input.model || "unknown", note: error instanceof Error ? error.message : String(error) };
  }

  const { route, fallbackUsed } = selected;
  const key = process.env[route.apiKeyEnv] || "";
  if (!key) {
    return { status: "pending_llm", model: route.model, note: `${route.apiKeyEnv} not configured; ${route.provider} was not called.`, provider: route.provider, fallbackUsed };
  }

  const content: unknown = input.images?.length
    ? [{ type: "text", text: input.prompt }, ...input.images.slice(0, 8).map((url) => ({ type: "image_url", image_url: { url } }))]
    : input.prompt;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  const requestPayload = {
    model: route.model,
    temperature: input.temperature ?? 0.1,
    ...(input.maxTokens ? { max_tokens: Math.max(1, Math.floor(input.maxTokens)) } : {}),
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: ensureJsonPrompt(input.system) }, { role: "user", content }],
  };
  let payloadForLog: unknown;

  try {
    const response = await fetch(route.baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });
    const durationMs = Date.now() - started;
    if (!response.ok) {
      payloadForLog = await response.text().catch(() => "");
      const error = `${route.provider} HTTP ${response.status}`;
      void recordUsageEvent({ event: "llm_call", provider: route.provider, model: route.model, status: "error", durationMs, metadata: { multimodal: Boolean(input.images?.length) } });
      await recordApiLog({ module: "system", provider: route.provider, endpoint: route.baseUrl + "/chat/completions", method: "POST", status: "error", statusCode: response.status, durationMs, request: requestPayload, response: payloadForLog, error });
      if (input.images?.length && shouldRetryWithoutImages(response.status, String(payloadForLog))) {
        return retryTextOnly(input, "图片链接无法被模型下载，已自动改用笔记文字完成语义分析。");
      }
      return { status: "error", model: route.model, note: error, provider: route.provider, fallbackUsed };
    }
    const payload = await response.json() as any;
    payloadForLog = payload;
    const result = {
      status: "scored" as const,
      model: route.model,
      data: decode(payload.choices?.[0]?.message?.content || ""),
      provider: route.provider,
      fallbackUsed,
    };
    void recordUsageEvent({ event: "llm_call", provider: route.provider, model: route.model, status: "success", durationMs, metadata: { multimodal: Boolean(input.images?.length) } });
    await recordApiLog({ module: "system", provider: route.provider, endpoint: route.baseUrl + "/chat/completions", method: "POST", status: "success", statusCode: response.status, durationMs, request: requestPayload, response: payloadForLog });
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    const note = error instanceof Error && error.name === "AbortError"
      ? `${route.provider} request timeout (${timeoutMs()}ms)`
      : error instanceof Error ? error.message : String(error);
    void recordUsageEvent({ event: "llm_call", provider: route.provider, model: route.model, status: "error", durationMs, metadata: { multimodal: Boolean(input.images?.length) } });
    await recordApiLog({ module: "system", provider: route.provider, endpoint: route.baseUrl + "/chat/completions", method: "POST", status: "error", durationMs, request: requestPayload, response: payloadForLog, error: note });
    if (input.images?.length && error instanceof Error && error.name === "AbortError") {
      return retryTextOnly(input, "图片分析超时，已自动改用笔记文字完成语义分析。");
    }
    return { status: "error", model: route.model, note, provider: route.provider, fallbackUsed };
  } finally {
    clearTimeout(timer);
  }
}
