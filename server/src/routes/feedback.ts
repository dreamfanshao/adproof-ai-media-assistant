import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { FeedbackRepository } from "../services/feedback-repository.js";

const createFeedbackSchema = z.object({
  category: z.enum(["bug", "suggestion", "question", "other"]),
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(5000),
  page_path: z.string().trim().max(500).nullable().optional(),
}).strict();

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const feedbackRoutes: FastifyPluginAsync<{ repository: FeedbackRepository }> = async (app, options) => {
  app.get("/feedback-tickets", { preHandler: app.requireAuth }, async (request) => {
    const data = await options.repository.list(requireUserId(request), request.auth?.accessToken);
    return { data, meta: { request_id: request.id, total: data.length } };
  });

  app.post("/feedback-tickets", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = createFeedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "请完善反馈类型、标题和问题描述。", false, {
        fields: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const data = await options.repository.create(requireUserId(request), parsed.data, request.auth?.accessToken);
    return reply.code(201).send({ data, meta: { request_id: request.id } });
  });
};
