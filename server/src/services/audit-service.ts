// T08 Phase 3｜审核服务：草稿创建 / 图片上传意图 / 提交（建 content_audit job）
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { ApiError } from "../errors.js";

const ASSET_BUCKET = "audit-assets";
const UPLOAD_TTL_MS = 15 * 60 * 1000;

export interface CreateAuditDraftInput {
  userId: string;
  title: string;
  body: string;
  requirements?: string;
  privateKnowledgeBaseIds?: string[];
}

export async function createAuditDraft(client: SupabaseClient, input: CreateAuditDraftInput): Promise<Record<string, unknown>> {
  // 校验私有知识库归属与可选择性
  if (input.privateKnowledgeBaseIds && input.privateKnowledgeBaseIds.length > 10) {
    throw new ApiError(400, "TOO_MANY_KNOWLEDGE_BASES", "最多选择 10 个私有知识库。", false);
  }
  if (input.privateKnowledgeBaseIds?.length) {
    const { data: kbs, error } = await client
      .from("knowledge_bases")
      .select("id,selectable")
      .in("id", input.privateKnowledgeBaseIds)
      .eq("user_id", input.userId)
      .eq("scope", "private");
    if (error) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
    const found = new Set((kbs ?? []).map((kb) => kb.id as string));
    const missing = input.privateKnowledgeBaseIds.filter((id) => !found.has(id));
    if (missing.length) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "部分知识库不存在或无权访问。", false);
    const unselectable = (kbs ?? []).filter((kb) => kb.selectable === false);
    if (unselectable.length) {
      throw new ApiError(409, "KNOWLEDGE_BASE_NOT_SELECTABLE", "所选知识库尚无可用文档，无法用于审核。", false);
    }
  }

  const { data, error } = await client
    .from("audit_tasks")
    .insert({
      user_id: input.userId,
      idempotency_key: randomUUID(),
      title: input.title,
      body: input.body,
      requirements: input.requirements ?? null,
      private_knowledge_base_ids: input.privateKnowledgeBaseIds ?? [],
      status: "draft",
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "AUDIT_TASK_CREATE_FAILED", "创建审核草稿失败。", true, { detail: error.message });
  return data;
}

export async function createAuditAssetUploadIntent(
  client: SupabaseClient,
  pool: pg.Pool,
  userId: string,
  input: { auditTaskId: string; fileName: string; mimeType: "image/jpeg" | "image/png"; sizeBytes: number; checksumSha256: string },
): Promise<{ upload_id: string; storage_path: string; method: "PUT"; upload_url: string; required_headers: Record<string, string>; expires_at: string }> {
  const { data: task } = await client.from("audit_tasks").select("id,status").eq("id", input.auditTaskId).eq("user_id", userId).maybeSingle();
  if (!task) throw new ApiError(404, "AUDIT_TASK_NOT_FOUND", "审核任务不存在或无权访问。", false);
  if (task.status !== "draft") throw new ApiError(409, "AUDIT_TASK_NOT_DRAFT", "仅草稿可添加图片。", false);

  const uploadId = randomUUID();
  const ext = input.mimeType === "image/png" ? "png" : "jpg";
  const storagePath = `${userId}/${uploadId}/asset.${ext}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
  await pool.query(
    `insert into private.upload_intents (id, user_id, kind, storage_path, file_name, mime_type, size_bytes, checksum_sha256, status, expires_at)
     values ($1, $2, 'audit_asset', $3, $4, $5, $6, $7, 'pending', $8)`,
    [uploadId, userId, storagePath, input.fileName, input.mimeType, input.sizeBytes, input.checksumSha256, expiresAt.toISOString()],
  );
  const { data, error } = await client.storage.from(ASSET_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl) {
    await pool.query("delete from private.upload_intents where id = $1", [uploadId]).catch(() => undefined);
    throw new ApiError(500, "STORAGE_SIGNED_URL_FAILED", "生成上传地址失败。", true);
  }
  return { upload_id: uploadId, storage_path: storagePath, method: "PUT", upload_url: data.signedUrl, required_headers: { "Content-Type": input.mimeType }, expires_at: expiresAt.toISOString() };
}

export async function commitAuditAsset(
  client: SupabaseClient,
  pool: pg.Pool,
  userId: string,
  input: { auditTaskId: string; uploadId: string; storagePath: string; fileName: string; mimeType: "image/jpeg" | "image/png"; sizeBytes: number; checksumSha256: string; sortOrder: number },
): Promise<Record<string, unknown>> {
  const { rows: intents } = await pool.query(
    "select * from private.upload_intents where id = $1 and user_id = $2 and kind = 'audit_asset' and status = 'pending'",
    [input.uploadId, userId],
  );
  const intent = intents[0];
  if (!intent) throw new ApiError(404, "UPLOAD_INTENT_NOT_FOUND", "上传意图不存在或已失效。", false);
  if (intent.storage_path !== input.storagePath || Number(intent.size_bytes) !== input.sizeBytes) {
    throw new ApiError(409, "UPLOAD_INTENT_MISMATCH", "上传参数与意图不一致。", false);
  }
  const { data: objectInfo, error: infoError } = await client.storage.from(ASSET_BUCKET).info(input.storagePath);
  if (infoError || !objectInfo) throw new ApiError(409, "UPLOAD_NOT_FOUND", "文件尚未上传完成。", false);
  if (objectInfo.metadata?.size && Number(objectInfo.metadata.size) !== input.sizeBytes) {
    throw new ApiError(409, "UPLOAD_SIZE_MISMATCH", "文件大小与声明不一致。", false);
  }
  await pool.query("update private.upload_intents set status = 'committed', committed_at = now() where id = $1", [input.uploadId]);
  const { data, error } = await client
    .from("audit_assets")
    .insert({
      user_id: userId,
      audit_task_id: input.auditTaskId,
      storage_path: input.storagePath,
      file_name: input.fileName,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      checksum_sha256: input.checksumSha256,
      sort_order: input.sortOrder,
    })
    .select("*")
    .single();
  if (error) throw new ApiError(500, "AUDIT_ASSET_CREATE_FAILED", "保存图片失败。", true);
  return data;
}

/** 提交审核：先建 content_audit job，再给 audit_tasks 补 task_id 并转 queued */
export async function submitAuditTask(
  client: SupabaseClient,
  pool: pg.Pool,
  userId: string,
  auditTaskId: string,
): Promise<Record<string, unknown>> {
  const { data: task } = await client.from("audit_tasks").select("id,status,title,body").eq("id", auditTaskId).eq("user_id", userId).maybeSingle();
  if (!task) throw new ApiError(404, "AUDIT_TASK_NOT_FOUND", "审核任务不存在或无权访问。", false);
  if (task.status !== "draft") throw new ApiError(409, "AUDIT_TASK_NOT_DRAFT", "仅草稿可提交。", false);

  const jobId = randomUUID();
  try {
    await pool.query(
      `insert into private.jobs (id, user_id, type, status, stage, payload, idempotency_scope, idempotency_key, run_after)
       values ($1, $2, 'content_audit', 'queued', 'queued', $3, 'content_audit', $4, now())`,
      [jobId, userId, { audit_task_id: auditTaskId }, randomUUID()],
    );
  } catch (error) {
    throw new ApiError(500, "AUDIT_SUBMIT_FAILED", "创建审核任务失败。", true, { detail: error instanceof Error ? error.message : String(error) });
  }
  const { data, error } = await client
    .from("audit_tasks")
    .update({ task_id: jobId, status: "queued", message_code: "AUDIT_QUEUED", updated_at: new Date().toISOString() })
    .eq("id", auditTaskId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) {
    await pool.query("delete from private.jobs where id = $1", [jobId]).catch(() => undefined);
    throw new ApiError(500, "AUDIT_SUBMIT_FAILED", "提交审核失败。", true, { detail: error.message });
  }
  return data;
}
