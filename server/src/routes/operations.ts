import type { FastifyPluginAsync } from "fastify";
import type pg from "pg";
import { ApiError } from "../errors.js";
import { isAdmin, requireAdmin } from "../services/admin-access.js";
import { getOperationsOverview } from "../services/operations-analytics.js";

export const operationsRoutes: FastifyPluginAsync<{ pool: pg.Pool | null }> = async (app, options) => {
  app.get("/operations/access", { preHandler: app.requireAuth }, async (request) => {
    if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    return { data: { isAdmin: await isAdmin(options.pool, request.auth.userId) }, meta: { request_id: request.id } };
  });

  app.get("/operations/overview", { preHandler: [app.requireAuth, async (request) => {
    if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    await requireAdmin(options.pool, request.auth.userId);
  }] }, async (_request, reply) => {
    if (!options.pool) return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "运营数据服务尚未就绪。" } });
    return { data: await getOperationsOverview(options.pool) };
  });
};
