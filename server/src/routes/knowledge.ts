// T08 Phase 1｜知识库路由：CRUD / 上传意图 / 文档提交
import type { FastifyPluginAsync } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { commitKnowledgeDocument, createDocumentUploadIntent } from "../services/knowledge-service.js";
import { getKnowledgeDocumentContent } from "../services/knowledge-content-service.js";

const createKbSchema = z.object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(500).optional() }).strict();
const updateKbSchema = z.object({ name: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(500).nullable().optional(), selectable: z.boolean().optional() }).strict();
const uploadIntentSchema = z.object({
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown"]),
  size_bytes: z.number().int().min(1).max(20_971_520),
  checksum_sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
}).strict();
const commitSchema = uploadIntentSchema.extend({ upload_id: z.string().uuid(), storage_path: z.string().min(1) }).strict();
const contentQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

function requireUserId(request: import("fastify").FastifyRequest): string {
  if (!request.auth) throw new ApiError(401, "AUTH_REQUIRED", "请先登录。", false);
  return request.auth.userId;
}

export const knowledgeRoutes: FastifyPluginAsync<{ client: SupabaseClient; pool: pg.Pool }> = async (app, options) => {
  // 列表：公共库 + 本人私有库
  app.get("/knowledge-bases", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("knowledge_bases")
      .select("*")
      .or(`scope.eq.public_law,user_id.eq.${userId}`)
      .order("created_at", { ascending: false });
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  app.post("/knowledge-bases", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = createKbSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "知识库参数不正确。", false);
    const { data, error } = await options.client
      .from("knowledge_bases")
      .insert({ user_id: userId, scope: "private", name: parsed.data.name, description: parsed.data.description ?? null })
      .select("*")
      .single();
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_CREATE_FAILED", "创建知识库失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  app.get("/knowledge-bases/:knowledgeBaseId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("knowledge_bases")
      .select("*")
      .eq("id", (request.params as Record<string, string>).knowledgeBaseId)
      .or(`scope.eq.public_law,user_id.eq.${userId}`)
      .maybeSingle();
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
    if (!data) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });

  app.patch("/knowledge-bases/:knowledgeBaseId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = updateKbSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "知识库参数不正确。", false);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) patch.name = parsed.data.name;
    if (parsed.data.description !== undefined) patch.description = parsed.data.description;
    if (parsed.data.selectable !== undefined) patch.selectable = parsed.data.selectable;
    const { data, error } = await options.client
      .from("knowledge_bases")
      .update(patch)
      .eq("id", (request.params as Record<string, string>).knowledgeBaseId)
      .eq("user_id", userId)
      .eq("scope", "private")
      .select("*")
      .maybeSingle();
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_UPDATE_FAILED", "更新知识库失败。", true);
    if (!data) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });

  app.delete("/knowledge-bases/:knowledgeBaseId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { error } = await options.client
      .from("knowledge_bases")
      .delete()
      .eq("id", (request.params as Record<string, string>).knowledgeBaseId)
      .eq("user_id", userId)
      .eq("scope", "private");
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_DELETE_FAILED", "删除知识库失败。", true);
    return { data: { id: (request.params as Record<string, string>).knowledgeBaseId }, meta: { request_id: request.id } };
  });

  // 文档上传意图（签名 PUT URL）
  app.post("/knowledge-bases/:knowledgeBaseId/document-upload-intents", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = uploadIntentSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "上传参数不正确。", false, { fields: parsed.error.issues.map((i) => i.path.join(".")) });
    const intent = await createDocumentUploadIntent(options.client, options.pool, {
      userId,
      knowledgeBaseId: (request.params as Record<string, string>).knowledgeBaseId,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      checksumSha256: parsed.data.checksum_sha256,
    });
    return { data: intent, meta: { request_id: request.id } };
  });

  // 文档列表
  app.get("/knowledge-bases/:knowledgeBaseId/documents", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const knowledgeBaseId = (request.params as Record<string, string>).knowledgeBaseId;
    const { data: knowledgeBase, error: knowledgeBaseError } = await options.client
      .from("knowledge_bases")
      .select("id,scope,user_id")
      .eq("id", knowledgeBaseId)
      .or(`scope.eq.public_law,user_id.eq.${userId}`)
      .maybeSingle();
    if (knowledgeBaseError) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
    if (!knowledgeBase) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在或无权访问。", false);

    let documentsQuery = options.client
      .from("knowledge_documents")
      .select("id,knowledge_base_id,file_name,mime_type,size_bytes,page_count,chunk_count,status,version,error_code,created_at,updated_at")
      .eq("knowledge_base_id", knowledgeBaseId);
    documentsQuery = knowledgeBase.scope === "public_law" ? documentsQuery.is("user_id", null) : documentsQuery.eq("user_id", userId);
    const { data, error } = await documentsQuery.order("created_at", { ascending: false });
    if (error) throw new ApiError(500, "DOCUMENT_QUERY_FAILED", "查询文档失败。", true);
    return { data, meta: { request_id: request.id } };
  });

  // 提交文档（上传完成后）
  app.post("/knowledge-bases/:knowledgeBaseId/documents", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = commitSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "提交参数不正确。", false);
    const doc = await commitKnowledgeDocument(options.client, options.pool, {
      userId,
      knowledgeBaseId: (request.params as Record<string, string>).knowledgeBaseId,
      uploadId: parsed.data.upload_id,
      storagePath: parsed.data.storage_path,
      fileName: parsed.data.file_name,
      mimeType: parsed.data.mime_type,
      sizeBytes: parsed.data.size_bytes,
      checksumSha256: parsed.data.checksum_sha256,
    });
    return { data: doc, meta: { request_id: request.id } };
  });

  // 文档详情/删除
  app.get("/knowledge-documents/:documentId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data, error } = await options.client
      .from("knowledge_documents")
      .select("*")
      .eq("id", (request.params as Record<string, string>).documentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ApiError(500, "DOCUMENT_QUERY_FAILED", "查询文档失败。", true);
    if (!data) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在或无权访问。", false);
    return { data, meta: { request_id: request.id } };
  });

  // 私有文档解析内容：按当前用户、文档版本分页读取切块正文。
  app.get("/knowledge-documents/:documentId/content", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const parsed = contentQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_INVALID_REQUEST", "内容分页参数不正确。", false);
    }
    const page = await getKnowledgeDocumentContent(options.client, {
      userId,
      documentId: (request.params as Record<string, string>).documentId,
      offset: parsed.data.offset,
      limit: parsed.data.limit,
    });
    return {
      data: { document: page.document, chunks: page.chunks },
      meta: {
        request_id: request.id,
        total: page.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        has_more: parsed.data.offset + page.chunks.length < page.total,
      },
    };
  });

  app.delete("/knowledge-documents/:documentId", { preHandler: app.requireAuth }, async (request) => {
    const userId = requireUserId(request);
    const { data: doc, error: findError } = await options.client
      .from("knowledge_documents")
      .select("storage_path")
      .eq("id", (request.params as Record<string, string>).documentId)
      .eq("user_id", userId)
      .maybeSingle();
    if (findError) throw new ApiError(500, "DOCUMENT_QUERY_FAILED", "查询文档失败。", true);
    if (!doc) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在或无权访问。", false);
    await options.client.storage.from("knowledge-documents").remove([doc.storage_path as string]).catch(() => undefined);
    const { error } = await options.client.from("knowledge_documents").delete().eq("id", (request.params as Record<string, string>).documentId).eq("user_id", userId);
    if (error) throw new ApiError(500, "DOCUMENT_DELETE_FAILED", "删除文档失败。", true);
    return { data: { id: (request.params as Record<string, string>).documentId }, meta: { request_id: request.id } };
  });
};
