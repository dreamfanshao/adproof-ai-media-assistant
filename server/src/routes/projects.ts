// Phase 3｜项目路由（最小集：列表/创建/详情）
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "../errors.js";

const createProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    product_name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    product_name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "至少提供一个修改字段" });

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const projectRoutes: FastifyPluginAsync<{ client: SupabaseClient }> = async (app, options) => {
  app.get("/projects", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new ApiError(500, "PROJECT_QUERY_FAILED", "查询项目失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  app.post("/projects", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = createProjectSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "项目参数不正确。", false);
    }
    const { data, error } = await options.client
      .from("projects")
      .insert({ user_id: userId, idempotency_key: randomUUID(), name: parsed.data.name, product_name: parsed.data.product_name, description: parsed.data.description ?? null })
      .select("*")
      .single();
    if (error) throw new ApiError(500, "PROJECT_CREATE_FAILED", "创建项目失败。", true, { detail: error.message });
    return { data, meta: { request_id: request.id } };
  });

  app.get("/projects/:projectId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("projects")
      .select("*")
      .eq("id", (request.params as Record<string, string>).projectId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ApiError(500, "PROJECT_QUERY_FAILED", "查询项目失败。", true);
    if (!data) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });

  app.patch("/projects/:projectId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = updateProjectSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "项目修改参数不正确。", false);
    const projectId = (request.params as Record<string, string>).projectId;
    const { data, error } = await options.client
      .from("projects")
      .update(parsed.data)
      .eq("id", projectId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw new ApiError(500, "PROJECT_UPDATE_FAILED", "更新项目失败。", true, { detail: error.message });
    if (!data) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });
};
