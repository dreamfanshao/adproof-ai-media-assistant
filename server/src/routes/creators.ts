// Phase 3/4｜项目达人路由（列表/更新状态/Excel 导出）
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { exportProjectCreatorsXlsx } from "../services/creator-export-service.js";

const updateCreatorSchema = z
  .object({
    decision_status: z.enum(["pending", "selected", "discarded"]).optional(),
    contact_status: z.enum(["not_contacted", "contacting", "cooperated", "unreachable"]).optional(),
    group_id: z.string().uuid().nullable().optional(),
    discard_reason: z.string().max(500).nullable().optional(),
  })
  .strict();

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const creatorRoutes: FastifyPluginAsync<{ client: SupabaseClient }> = async (app, options) => {
  // 项目达人列表（按 match_score 降序，缺失排后）
  app.get("/projects/:projectId/creators", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const status = (request.query as { status?: string }).status;
    let query = options.client
      .from("project_creators")
      .select("*, creators(platform, nickname, handle, profile_url, avatar_url, platform_creator_id, latest_snapshot, latest_captured_at)")
      .eq("project_id", (request.params as Record<string, string>).projectId)
      .eq("user_id", userId)
      .order("match_score", { ascending: false, nullsFirst: false });
    if (status === "selected" || status === "discarded" || status === "pending") {
      query = query.eq("decision_status", status);
    }
    const { data, error } = await query;
    if (error) throw new ApiError(500, "CREATOR_QUERY_FAILED", "查询达人失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  // 更新达人状态（选入/弃用/分组/联系状态）
  app.patch("/project-creators/:projectCreatorId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = updateCreatorSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "达人状态参数不正确。", false);
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.decision_status !== undefined) patch.decision_status = parsed.data.decision_status;
    if (parsed.data.contact_status !== undefined) patch.contact_status = parsed.data.contact_status;
    if (parsed.data.group_id !== undefined) patch.group_id = parsed.data.group_id;
    if (parsed.data.discard_reason !== undefined) patch.discard_reason = parsed.data.discard_reason;

    const { data, error } = await options.client
      .from("project_creators")
      .update(patch)
      .eq("id", (request.params as Record<string, string>).projectCreatorId)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();
    if (error) throw new ApiError(500, "CREATOR_UPDATE_FAILED", "更新达人状态失败。", true);
    if (!data) throw new ApiError(404, "PROJECT_CREATOR_NOT_FOUND", "达人不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });

  // 导出项目达人 Excel（FR-09）
  app.get("/projects/:projectId/creators/export.xlsx", { preHandler: app.requireAuth }, async (request, reply) => {
    const userId = requireUserId(request);
    const status = (request.query as { status?: string }).status;
    if (status && !["pending", "selected", "discarded"].includes(status)) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "导出状态参数不正确。", false);
    }
    const buffer = await exportProjectCreatorsXlsx(options.client, (request.params as Record<string, string>).projectId, userId, status);
    if (!buffer) throw new ApiError(404, "PROJECT_NOT_FOUND", "项目不存在或无权访问。", false);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `达人列表_${date}.xlsx`;
    // Node 不允许非 ASCII 头字段值：用 RFC 5987 filename* 百分号编码
    const safeName = `creators-${date}.xlsx`;
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .header("Content-Length", String(buffer.length))
      .send(buffer);
  });
};
