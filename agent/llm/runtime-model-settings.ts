import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelProviderId, ResolvedModelSettings } from "../../server/src/services/model-settings-service.js";

export interface RuntimeModelSettings extends ResolvedModelSettings {
  supportsVision: boolean;
}

const runtimeSettings = new AsyncLocalStorage<RuntimeModelSettings>();

export function withRuntimeModelSettings<T>(settings: ResolvedModelSettings | null, operation: () => Promise<T>): Promise<T> {
  if (!settings) return operation();
  return runtimeSettings.run({
    ...settings,
    supportsVision: modelSupportsVision(settings.provider, settings.modelId),
  }, operation);
}

export function currentRuntimeModelSettings(): RuntimeModelSettings | null {
  return runtimeSettings.getStore() ?? null;
}

export function modelSupportsVision(provider: ModelProviderId, modelId: string): boolean {
  if (provider === "deepseek") return /vision/i.test(modelId);
  if (provider === "qwen") return !/(coder|math|audio|tts)/i.test(modelId);
  if (provider === "glm") return /(?:^|[-.])(?:\d+(?:\.\d+)?)v(?:-|$)|vision/i.test(modelId) || modelId === "glm-5.3-flash";
  return true;
}
