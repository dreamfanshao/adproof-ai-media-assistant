import { apiRequest } from "./api-client";

export type ModelProviderId = "anthropic" | "openai" | "deepseek" | "qwen" | "glm";

export interface AvailableModel {
  id: string;
  name: string;
}

export interface ModelProviderSetting {
  id: ModelProviderId;
  name: string;
  short_name: string;
  base_url: string;
  default_model: string;
  models: AvailableModel[];
  configured: boolean;
  active: boolean;
  model_id: string | null;
  fingerprint: string | null;
  updated_at: string | null;
}

export interface ModelSettingsData {
  providers: ModelProviderSetting[];
}

export function getModelSettings(accessToken: string) {
  return apiRequest<{ data: ModelSettingsData; meta: { storage_available: boolean } }>("/model-settings", accessToken);
}

export function refreshProviderModels(accessToken: string, provider: ModelProviderId, apiKey?: string) {
  return apiRequest<{ data: { provider: ModelProviderId; models: AvailableModel[] } }>("/model-settings/models", accessToken, {
    method: "POST",
    body: JSON.stringify({ provider, ...(apiKey ? { api_key: apiKey } : {}) }),
  });
}

export function testModelConnection(accessToken: string, provider: ModelProviderId, modelId: string, apiKey?: string) {
  return apiRequest<{ data: { connected: true; provider: ModelProviderId; model_id: string } }>("/model-settings/test", accessToken, {
    method: "POST",
    body: JSON.stringify({ provider, model_id: modelId, ...(apiKey ? { api_key: apiKey } : {}) }),
  });
}

export function saveModelSettings(accessToken: string, provider: ModelProviderId, modelId: string, apiKey?: string) {
  return apiRequest<{ data: ModelSettingsData }>("/model-settings", accessToken, {
    method: "PUT",
    body: JSON.stringify({ provider, model_id: modelId, ...(apiKey ? { api_key: apiKey } : {}) }),
  });
}
