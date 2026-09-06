import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ProfileRepository } from "../services/profile-repository.js";

const updateProfileSchema = z.object({
  display_name: z.string().trim().min(1).max(50),
}).strict();

export const profileRoutes: FastifyPluginAsync<{ repository: ProfileRepository }> = async (app, options) => {
  app.get("/me", { preHandler: app.requireAuth }, async (request) => {
    const auth = request.auth;
    if (!auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    const profile = await options.repository.get(auth.accessToken, auth.userId, auth.email);
    return { data: profile, meta: { request_id: request.id } };
  });

  app.patch("/me", { preHandler: app.requireAuth }, async (request) => {
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "用户资料格式不正确。", false, {
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const auth = request.auth;
    if (!auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
    const profile = await options.repository.update(
      auth.accessToken,
      auth.userId,
      auth.email,
      parsed.data.display_name,
    );
    return { data: profile, meta: { request_id: request.id } };
  });
};
