import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../errors.js";
import type { XhsConnectionService } from "../services/xhs-connection-service.js";

function userId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "Please sign in first", false);
  return request.auth.userId;
}

function apiConnection() {
  const now = new Date().toISOString();
  return {
    id: null,
    task_id: null,
    platform: "xiaohongshu" as const,
    status: "connected" as const,
    qr_image_url: null,
    qr_expires_at: null,
    session_expires_at: null,
    last_verified_at: now,
    account_display_name: "RedFoxHub API",
    account_handle_masked: null,
    avatar_url: null,
    message_code: "XHS_REDFOX_ACTIVE",
    created_at: now,
    updated_at: now,
  };
}

export const platformConnectionRoutes: FastifyPluginAsync<{ service: XhsConnectionService; dataProvider: "redfox" }> = async (app) => {
  app.get("/xhs-data-source", { preHandler: app.requireAuth }, async (request) => ({
    data: { provider: "redfox", requiresLogin: false },
    meta: { request_id: request.id },
  }));

  app.post("/platform-connections/xiaohongshu", { preHandler: app.requireAuth }, async (_request, reply) => {
    throw new ApiError(409, "XHS_QR_NOT_REQUIRED", "当前使用 RedFoxHub API，无需扫码登录", false);
  });

  app.get("/platform-connections/xiaohongshu", { preHandler: app.requireAuth }, async (request) => ({
    data: apiConnection(),
    meta: { request_id: request.id },
  }));

  app.post("/platform-connections/xiaohongshu/verify", { preHandler: app.requireAuth }, async () => {
    throw new ApiError(409, "XHS_QR_NOT_REQUIRED", "当前使用 RedFoxHub API，无需扫码验证", false);
  });

  app.delete("/platform-connections/xiaohongshu", { preHandler: app.requireAuth }, async (_request, reply) => reply.status(204).send());
};
