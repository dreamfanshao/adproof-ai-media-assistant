import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { MODEL_PROVIDERS, ModelProviderClient, modelIdMatchesProvider, modelProvider } from "../services/model-provider-service.js";
import { MODEL_PROVIDER_IDS, type ModelProviderId, type ModelSettingsStore } from "../services/model-settings-service.js";

const providerSchema = z.enum(MODEL_PROVIDER_IDS);
const apiKeySchema = z.string().trim().min(8).max(500);
const modelIdSchema = z.string().trim().min(1).max(160).regex(/^[a-zA-Z0-9._:/-]+$/);
const providerRequestSchema = z.object({ provider: providerSchema, api_key: apiKeySchema.optional() }).strict();
const saveSchema = z.object({ provider: providerSchema, model_id: modelIdSchema, api_key: apiKeySchema.optional() }).strict();
const testSchema = z.object({ provider: providerSchema, model_id: modelIdSchema, api_key: apiKeySchema.optional() }).strict();

async function keyFor(store: ModelSettingsStore | undefined, userId: string, provider: ModelProviderId, temporary?: string): Promise<string> {
  if (temporary) return temporary;
  let saved: string | null | undefined;
  try {
    saved = await store?.resolveKey(userId, provider);
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
  }
  if (!saved) throw new ApiError(400, "MODEL_API_KEY_REQUIRED", "请先输入该服务商的 API Key。", false);
  return saved;
}

function isUndefinedTable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "42P01";
}

function responseData(statuses: Awaited<ReturnType<ModelSettingsStore["status"]>>) {
  const byProvider = new Map(statuses.map((item) => [item.provider, item]));
  return {
    providers: MODEL_PROVIDERS.map((provider) => {
      const saved = byProvider.get(provider.id);
      return {
        id: provider.id,
        name: provider.name,
        short_name: provider.shortName,
        base_url: provider.baseUrl,
        default_model: provider.defaultModel,
        models: provider.models,
        configured: saved?.configured ?? false,
        active: saved?.active ?? false,
        model_id: saved?.modelId ?? null,
        fingerprint: saved?.fingerprint ?? null,
        updated_at: saved?.updatedAt ?? null,
      };
    }),
  };
}

export const modelSettingsRoutes: FastifyPluginAsync<{
  store?: ModelSettingsStore;
  client?: ModelProviderClient;
}> = async (app, options) => {
  const providerClient = options.client ?? new ModelProviderClient();

  app.get("/model-settings", { preHandler: app.requireAuth }, async (request) => {
    let statuses: Awaited<ReturnType<ModelSettingsStore["status"]>> = [];
    let storageAvailable = Boolean(options.store);
    try {
      statuses = options.store ? await options.store.status(request.auth!.userId) : [];
    } catch (error) {
      if (!isUndefinedTable(error)) throw error;
      storageAvailable = false;
    }
    return { data: responseData(statuses), meta: { request_id: request.id, storage_available: storageAvailable } };
  });

  app.post("/model-settings/models", { preHandler: app.requireAuth }, async (request) => {
    const parsed = providerRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "请选择有效的模型服务商。", false);
    const apiKey = await keyFor(options.store, request.auth!.userId, parsed.data.provider, parsed.data.api_key);
    const models = await providerClient.list(parsed.data.provider, apiKey);
    return { data: { provider: parsed.data.provider, models }, meta: { request_id: request.id } };
  });

  app.post("/model-settings/test", { preHandler: app.requireAuth }, async (request) => {
    const parsed = testSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "请选择有效的服务商和模型。", false);
    if (!modelIdMatchesProvider(parsed.data.provider, parsed.data.model_id)) throw new ApiError(400, "MODEL_PROVIDER_MISMATCH", "模型与所选服务商不匹配。", false);
    const apiKey = await keyFor(options.store, request.auth!.userId, parsed.data.provider, parsed.data.api_key);
    await providerClient.test(parsed.data.provider, parsed.data.model_id, apiKey);
    return { data: { connected: true, provider: parsed.data.provider, model_id: parsed.data.model_id }, meta: { request_id: request.id } };
  });

  app.put("/model-settings", { preHandler: app.requireAuth }, async (request) => {
    if (!options.store) throw new ApiError(503, "MODEL_SETTINGS_STORAGE_UNAVAILABLE", "模型设置安全存储尚未配置。", true);
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "请输入有效的服务商、模型和 API Key。", false);
    if (!modelIdMatchesProvider(parsed.data.provider, parsed.data.model_id)) throw new ApiError(400, "MODEL_PROVIDER_MISMATCH", "模型与所选服务商不匹配。", false);
    const provider = modelProvider(parsed.data.provider);
    let statuses;
    try {
      statuses = await options.store.save(request.auth!.userId, {
        provider: parsed.data.provider,
        modelId: parsed.data.model_id,
        baseUrl: provider.baseUrl,
        apiKey: parsed.data.api_key,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "MODEL_API_KEY_REQUIRED") {
        throw new ApiError(400, "MODEL_API_KEY_REQUIRED", "首次配置该服务商时必须输入 API Key。", false);
      }
      if (isUndefinedTable(error)) {
        throw new ApiError(503, "MODEL_SETTINGS_MIGRATION_REQUIRED", "模型设置数据表尚未创建，请先应用数据库迁移。", true);
      }
      throw error;
    }
    return { data: responseData(statuses), meta: { request_id: request.id, storage_available: true } };
  });
};
