import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { RedfoxCredentialStore } from "../services/redfox-credential-service.js";

const saveSchema = z.object({ api_key: z.string().trim().min(16).max(500) }).strict();

export const redfoxCredentialRoutes: FastifyPluginAsync<{
  store?: RedfoxCredentialStore;
  systemDefaultConfigured: boolean;
}> = async (app, options) => {
  app.get("/redfox-credential", { preHandler: app.requireAuth }, async (request) => {
    const saved = options.store
      ? await options.store.status(request.auth!.userId)
      : { configured: false, fingerprint: null, updatedAt: null };
    return {
      data: {
        configured: saved.configured || options.systemDefaultConfigured,
        source: saved.configured ? "user" : options.systemDefaultConfigured ? "system" : "none",
        fingerprint: saved.fingerprint,
        updated_at: saved.updatedAt,
        replaceable: Boolean(options.store),
      },
      meta: { request_id: request.id },
    };
  });

  app.put("/redfox-credential", { preHandler: app.requireAuth }, async (request) => {
    if (!options.store) throw new ApiError(503, "REDFOX_CREDENTIAL_STORAGE_UNAVAILABLE", "API Key 安全存储尚未配置。", true);
    const parsed = saveSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "请输入有效的 RedFox API Key。", false);
    const saved = await options.store.save(request.auth!.userId, parsed.data.api_key);
    return {
      data: {
        configured: true,
        source: "user",
        fingerprint: saved.fingerprint,
        updated_at: saved.updatedAt,
        replaceable: true,
      },
      meta: { request_id: request.id },
    };
  });
};
