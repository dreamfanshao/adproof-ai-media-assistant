import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../errors.js";

export interface KnowledgeContentPage {
  document: {
    id: string;
    knowledge_base_id: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    page_count: number | null;
    chunk_count: number | null;
    status: string;
    version: number;
    created_at: string;
    updated_at: string;
  };
  chunks: Array<{
    id: string;
    chunk_index: number;
    content: string;
    source_locator: string;
    metadata: unknown;
  }>;
  total: number;
}

/**
 * 读取当前用户私有知识库中的解析正文。
 * 即使调用方使用 service role，也必须显式约束 user_id，不能依赖 RLS 代替归属校验。
 */
export async function getPrivateKnowledgeDocumentContent(
  client: SupabaseClient,
  input: { userId: string; documentId: string; offset: number; limit: number },
): Promise<KnowledgeContentPage> {
  const { data: document, error: documentError } = await client
    .from("knowledge_documents")
    .select("id,knowledge_base_id,file_name,mime_type,size_bytes,page_count,chunk_count,status,version,created_at,updated_at")
    .eq("id", input.documentId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (documentError) {
    throw new ApiError(500, "DOCUMENT_QUERY_FAILED", "查询文档失败。", true);
  }
  if (!document) {
    throw new ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在或无权访问。", false);
  }

  const { data: chunks, count, error: chunksError } = await client
    .from("knowledge_chunks")
    .select("id,chunk_index,content,source_locator,metadata", { count: "exact" })
    .eq("document_id", input.documentId)
    .eq("knowledge_base_id", document.knowledge_base_id)
    .eq("document_version", document.version)
    .eq("user_id", input.userId)
    .order("chunk_index", { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);

  if (chunksError) {
    throw new ApiError(500, "KNOWLEDGE_CONTENT_QUERY_FAILED", "读取文档内容失败。", true);
  }

  return {
    document: document as KnowledgeContentPage["document"],
    chunks: (chunks ?? []) as KnowledgeContentPage["chunks"],
    total: count ?? 0,
  };
}

export type KnowledgeScope = "public_law" | "private";

/** Read public-law documents for every authenticated user and private documents only for their owner. */
export async function getKnowledgeDocumentContent(
  client: SupabaseClient,
  input: { userId: string; documentId: string; offset: number; limit: number },
): Promise<KnowledgeContentPage & { scope: KnowledgeScope }> {
  const { data: document, error: documentError } = await client
    .from("knowledge_documents")
    .select("id,knowledge_base_id,file_name,mime_type,size_bytes,page_count,chunk_count,status,version,created_at,updated_at,user_id")
    .eq("id", input.documentId)
    .maybeSingle();
  if (documentError) throw new ApiError(500, "DOCUMENT_QUERY_FAILED", "查询文档失败。", true);
  if (!document) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在或无权访问。", false);

  const { data: knowledgeBase, error: knowledgeBaseError } = await client
    .from("knowledge_bases")
    .select("id,scope,user_id")
    .eq("id", document.knowledge_base_id)
    .maybeSingle();
  if (knowledgeBaseError) throw new ApiError(500, "KNOWLEDGE_BASE_QUERY_FAILED", "查询知识库失败。", true);
  const scope: KnowledgeScope = knowledgeBase?.scope === "public_law" ? "public_law" : "private";
  const isPublicDocument = scope === "public_law" && document.user_id == null;
  const isPrivateOwner = scope === "private" && document.user_id === input.userId && knowledgeBase?.user_id === input.userId;
  if (!isPublicDocument && !isPrivateOwner) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "文档不存在或无权访问。", false);

  let query = client
    .from("knowledge_chunks")
    .select("id,chunk_index,content,source_locator,metadata", { count: "exact" })
    .eq("document_id", input.documentId)
    .eq("knowledge_base_id", document.knowledge_base_id)
    .eq("document_version", document.version);
  query = scope === "public_law" ? query.is("user_id", null) : query.eq("user_id", input.userId);
  const { data: chunks, count, error: chunksError } = await query
    .order("chunk_index", { ascending: true })
    .range(input.offset, input.offset + input.limit - 1);
  if (chunksError) throw new ApiError(500, "KNOWLEDGE_CONTENT_QUERY_FAILED", "读取文档内容失败。", true);
  return {
    document: document as KnowledgeContentPage["document"],
    chunks: (chunks ?? []) as KnowledgeContentPage["chunks"],
    total: count ?? 0,
    scope,
  };
}
