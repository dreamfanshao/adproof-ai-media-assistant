// T08 Phase 1｜知识库服务：CRUD / 签名上传意图 / 文档提交（建 knowledge_ingest job）
// public 表经 supabase-js（service_role）；private.upload_intents / private.jobs 经 pg 直连
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { ApiError } from "../errors.js";

const KB_BUCKET = "knowledge-documents";
const UPLOAD_TTL_MS = 15 * 60 * 1000;

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

export interface CreateUploadIntentInput {
  userId: string;
  knowledgeBaseId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface UploadIntentResult {
  upload_id: string;
  storage_path: string;
  method: "PUT";
  upload_url: string;
  required_headers: Record<string, string>;
  expires_at: string;
}

export interface CommitDocumentInput extends CreateUploadIntentInput {
  uploadId: string;
  storagePath: string;
}

/** 校验知识库归属（私有须本人；公共库不可上传） */
async function assertKnowledgeBase(client: SupabaseClient, userId: string, knowledgeBaseId: string): Promise<void> {
  const { data, error } = await client
    .from("knowledge_bases")
    .select("id,scope,user_id")
    .eq("id", knowledgeBaseId)
    .maybeSingle();
  if (error) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
  if (!data) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在或无权访问。", false);
  if (data.scope === "public_law") throw new ApiError(409, "PUBLIC_KB_IMMUTABLE", "公共知识库由平台维护，不可由用户修改。", false);
  if (data.user_id !== userId) throw new ApiError(404, "KNOWLEDGE_BASE_NOT_FOUND", "知识库不存在或无权访问。", false);
}

export async function createDocumentUploadIntent(
  client: SupabaseClient,
  pool: pg.Pool,
  input: CreateUploadIntentInput,
): Promise<UploadIntentResult> {
  await assertKnowledgeBase(client, input.userId, input.knowledgeBaseId);

  const uploadId = randomUUID();
  const ext = MIME_EXT[input.mimeType];
  if (!ext) throw new ApiError(400, "UNSUPPORTED_MIME_TYPE", "不支持的文件类型。", false);
  // Storage key 必须 ASCII（中文文件名会触发 InvalidKey）：显示名存 DB，存储路径用 doc.<ext>
  const storagePath = `${input.userId}/${uploadId}/doc.${ext}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);

  await pool.query(
    `insert into private.upload_intents
       (id, user_id, kind, storage_path, file_name, mime_type, size_bytes, checksum_sha256, status, expires_at)
     values ($1, $2, 'knowledge_document', $3, $4, $5, $6, $7, 'pending', $8)`,
    [uploadId, input.userId, storagePath, input.fileName, input.mimeType, input.sizeBytes, input.checksumSha256, expiresAt.toISOString()],
  );

  const { data, error } = await client.storage.from(KB_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data?.signedUrl) {
    await pool.query("delete from private.upload_intents where id = $1", [uploadId]).catch(() => undefined);
    throw new ApiError(500, "STORAGE_SIGNED_URL_FAILED", "生成上传地址失败。", true);
  }
  return {
    upload_id: uploadId,
    storage_path: storagePath,
    method: "PUT",
    upload_url: data.signedUrl,
    required_headers: { "Content-Type": input.mimeType },
    expires_at: expiresAt.toISOString(),
  };
}

/** 提交文档：校验意图与对象 → 标记 committed → 建 knowledge_ingest job → 建文档行 */
export async function commitKnowledgeDocument(
  client: SupabaseClient,
  pool: pg.Pool,
  input: CommitDocumentInput,
): Promise<Record<string, unknown>> {
  await assertKnowledgeBase(client, input.userId, input.knowledgeBaseId);

  // 校验上传意图
  const { rows: intents } = await pool.query(
    `select * from private.upload_intents where id = $1 and user_id = $2 and kind = 'knowledge_document' and status = 'pending'`,
    [input.uploadId, input.userId],
  );
  const intent = intents[0];
  if (!intent) throw new ApiError(404, "UPLOAD_INTENT_NOT_FOUND", "上传意图不存在或已失效。", false);
  // node-pg 把 bigint 返回为字符串，需转数值比较
  if (intent.storage_path !== input.storagePath || Number(intent.size_bytes) !== input.sizeBytes) {
    throw new ApiError(409, "UPLOAD_INTENT_MISMATCH", "上传参数与意图不一致。", false);
  }

  // 校验对象已上传且大小一致
  const { data: objectInfo, error: infoError } = await client.storage.from(KB_BUCKET).info(input.storagePath);
  if (infoError || !objectInfo) {
    throw new ApiError(409, "UPLOAD_NOT_FOUND", "文件尚未上传完成。", false);
  }
  if (objectInfo.metadata?.size && Number(objectInfo.metadata.size) !== input.sizeBytes) {
    throw new ApiError(409, "UPLOAD_SIZE_MISMATCH", "文件大小与声明不一致。", false);
  }

  await pool.query("update private.upload_intents set status = 'committed', committed_at = now() where id = $1", [input.uploadId]);

  // 同名文件去重（同一知识库内 checksum 唯一）
  const { data: existing } = await client
    .from("knowledge_documents")
    .select("id,status")
    .eq("knowledge_base_id", input.knowledgeBaseId)
    .eq("checksum_sha256", input.checksumSha256)
    .maybeSingle();
  if (existing) {
    throw new ApiError(409, "DUPLICATE_DOCUMENT", "该文件已存在于当前知识库。", false, { document_id: existing.id });
  }

  // 先建 job（knowledge_documents.task_id 外键引用 private.jobs.id）
  const jobId = randomUUID();
  const documentId = randomUUID();
  await pool.query(
    `insert into private.jobs (id, user_id, type, status, stage, payload, idempotency_scope, idempotency_key, run_after)
     values ($1, $2, 'knowledge_ingest', 'queued', 'queued', $3, 'knowledge_ingest', $4, now())`,
    [jobId, input.userId, { document_id: documentId, knowledge_base_id: input.knowledgeBaseId }, randomUUID()],
  );

  const { data: doc, error: docError } = await client
    .from("knowledge_documents")
    .insert({
      id: documentId,
      task_id: jobId,
      user_id: input.userId,
      knowledge_base_id: input.knowledgeBaseId,
      file_name: input.fileName,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      size_bytes: input.sizeBytes,
      checksum_sha256: input.checksumSha256,
      status: "uploaded",
      version: 1,
    })
    .select("*")
    .single();
  if (docError) {
    await pool.query("delete from private.jobs where id = $1", [jobId]).catch(() => undefined);
    throw new ApiError(500, "DOCUMENT_CREATE_FAILED", "创建文档记录失败。", true, { detail: docError.message });
  }
  return doc;
}
