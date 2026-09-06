// T08 Phase 3｜审核路由：草稿 / 图片上传 / 提交 / 查询
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { commitAuditAsset, createAuditAssetUploadIntent, createAuditDraft, submitAuditTask } from "../services/audit-service.js";
import { enforceRequestLimit, fingerprint, validateInput } from "../services/input-guard.js";

const createDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
  requirements: z.string().trim().max(5000).optional(),
  private_knowledge_base_ids: z.array(z.string().uuid()).max(10).optional(),
}).strict();

const uploadIntentSchema = z.object({
  audit_task_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.enum(["image/jpeg", "image/png"]),
  size_bytes: z.number().int().min(1).max(10_485_760),
  checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();

const commitAssetSchema = uploadIntentSchema.extend({ upload_id: z.string().uuid(), storage_path: z.string().min(1), sort_order: z.number().int().min(0).max(8) }).strict();

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const auditRoutes: FastifyPluginAsync<{ client: SupabaseClient; pool: pg.Pool }> = async (app, options) => {
  // 创建审核草稿
  app.post("/audit-tasks", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = createDraftSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "审核参数不正确。", false, { fields: parsed.error.issues.map((i) => i.path.join(".")) });
    const guard = validateInput([parsed.data.title, parsed.data.body, parsed.data.requirements ?? ""].join(" "), "audit");
    if (!guard.ok) throw new ApiError(422, guard.code, guard.message, false, { matchedTerms: guard.matchedTerms, confidence: guard.confidence });
    const limit = enforceRequestLimit("audit-draft", userId, fingerprint([parsed.data.title, parsed.data.body, parsed.data.requirements ?? ""]), { max: 8, windowMs: 60000, duplicateWindowMs: 300000 });
    if (!limit.ok) throw new ApiError(limit.code === "DUPLICATE_REQUEST" ? 409 : 429, limit.code, limit.message, true, { retryAfterSeconds: limit.retryAfterSeconds });
    const draft = await createAuditDraft(options.client, {
      userId,
      title: parsed.data.title,
      body: parsed.data.body,
      requirements: parsed.data.requirements,
      privateKnowledgeBaseIds: parsed.data.private_knowledge_base_ids,
    });
    return { data: draft, meta: { request_id: request.id } };
  });

  // 图片上传意图
  app.post("/audit-asset-upload-intents", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = uploadIntentSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "上传参数不正确。", false);
    const intent = await createAuditAssetUploadIntent(options.client, options.pool, userId, {
      auditTaskId: parsed.data.audit_task_id,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      checksumSha256: parsed.data.checksum_sha256,
    });
    return { data: intent, meta: { request_id: request.id } };
  });

  // 提交图片（上传完成后）
  app.post("/audit-asset-upload-intents/commit", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = commitAssetSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "提交参数不正确。", false);
    const asset = await commitAuditAsset(options.client, options.pool, userId, {
      auditTaskId: parsed.data.audit_task_id,
      uploadId: parsed.data.upload_id,
      storagePath: parsed.data.storage_path,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      checksumSha256: parsed.data.checksum_sha256,
      sortOrder: parsed.data.sort_order,
    });
    return { data: asset, meta: { request_id: request.id } };
  });

  // 提交审核（建 job）
  app.post("/audit-tasks/:auditTaskId/submit", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    try {
      const auditTaskId = (request.params as Record<string, string>).auditTaskId;
      const limit = enforceRequestLimit("audit-submit", userId, fingerprint([auditTaskId]), { max: 5, windowMs: 60000, duplicateWindowMs: 5000 });
      if (!limit.ok) throw new ApiError(limit.code === "DUPLICATE_REQUEST" ? 409 : 429, limit.code, limit.message, true, { retryAfterSeconds: limit.retryAfterSeconds });
      const task = await submitAuditTask(options.client, options.pool, userId, auditTaskId);
      return { data: task, meta: { request_id: request.id } };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(500, "AUDIT_SUBMIT_FAILED", "提交审核失败。", true, { detail: error instanceof Error ? error.message : String(error) });
    }
  });

  // 历史列表
  app.get("/audit-tasks", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("audit_tasks")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new ApiError(500, "AUDIT_TASK_QUERY_FAILED", "查询审核任务失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  // 单个任务（含发现与图片）
  app.get("/audit-tasks/:auditTaskId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const taskId = (request.params as Record<string, string>).auditTaskId;
    const { data: task, error } = await options.client
      .from("audit_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ApiError(500, "AUDIT_TASK_QUERY_FAILED", "查询审核任务失败。", true);
    if (!task) throw new ApiError(404, "AUDIT_TASK_NOT_FOUND", "审核任务不存在或无权访问。", false);
    const { data: findings } = await options.client
      .from("audit_findings")
      .select("*")
      .eq("audit_task_id", taskId)
      .eq("user_id", userId)
      .order("risk_level", { ascending: true });
    const { data: assets } = await options.client
      .from("audit_assets")
      .select("*")
      .eq("audit_task_id", taskId)
      .eq("user_id", userId)
      .order("sort_order", { ascending: true });
    const { data: coverageWarnings } = await options.client
      .from("audit_coverage_warnings")
      .select("code,message")
      .eq("audit_task_id", taskId)
      .eq("user_id", userId);
    return { data: { ...task, findings: findings ?? [], assets: assets ?? [], coverage_warnings: coverageWarnings ?? [] }, meta: { request_id: request.id } };
  });
};
