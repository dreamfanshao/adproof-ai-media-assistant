// T08 Phase 1｜知识库入库执行器（knowledge_ingest）：下载 → 校验 → 解析 → 切块 → 落库 → 状态流转
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import mammoth from "mammoth";
import { finishJob, type SearchJob, type WorkerEnv } from "./xhs-db.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string; numpages: number }>;

const CHUNK_MAX_CHARS = 800;
const CHUNK_OVERLAP_CHARS = 80;

interface IngestPayload {
  document_id: string;
  knowledge_base_id: string;
}

/** 按段落切块（400–800 字，约 10% 重叠；技术方案 §14.2） */
export function chunkText(text: string, maxLen = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP_CHARS): Array<{ content: string; locator: string }> {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const chunks: Array<{ content: string; locator: string }> = [];
  let buffer = "";
  let bufferStart = 0;
  let charCursor = 0;
  const paraStart: number[] = [];
  for (const para of paragraphs) {
    if ((buffer + para).length > maxLen && buffer.length > 0) {
      const start = Math.max(0, bufferStart - overlap);
      chunks.push({ content: buffer.slice(start === 0 ? 0 : overlap).trim(), locator: `p${paraStart[0] ?? 1}:${start}` });
      buffer = "";
      bufferStart = charCursor;
      paraStart.length = 0;
    }
    paraStart.push(charCursor);
    buffer += `${para}\n`;
    charCursor += para.length + 1;
  }
  if (buffer.trim().length > 0) {
    chunks.push({ content: buffer.trim(), locator: `p${paraStart[0] ?? 1}` });
  }
  return chunks;
}

async function parseDocument(buffer: Buffer, mimeType: string): Promise<{ text: string; pageCount: number | null }> {
  if (mimeType === "application/pdf") {
    const result = await pdfParse(buffer);
    return { text: result.text, pageCount: result.numpages ?? null };
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, pageCount: null };
  }
  return { text: buffer.toString("utf8"), pageCount: null };
}

/** 执行一个 knowledge_ingest job */
export async function runKnowledgeIngestJob(
  env: WorkerEnv,
  client: SupabaseClient,
  pool: pg.Pool,
  job: SearchJob,
): Promise<void> {
  const payload = job.payload as unknown as IngestPayload;
  const { document_id: documentId, knowledge_base_id: knowledgeBaseId } = payload;

  const fail = async (code: string, message: string): Promise<void> => {
    await client.from("knowledge_documents").update({ status: "failed", error_code: code, message_code: "KB_INGEST_FAILED", updated_at: new Date().toISOString() }).eq("id", documentId);
    await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "parsing", terminal: true, progress: 100, messageCode: "KB_INGEST_FAILED", errorCode: code, errorMessage: message });
  };

  try {
    const { data: doc, error: docError } = await client
      .from("knowledge_documents")
      .select("*")
      .eq("id", documentId)
      .maybeSingle();
    if (docError || !doc) {
      await finishJob(pool, { jobId: job.id, userId: job.user_id, status: "failed", stage: "queued", terminal: true, progress: 100, messageCode: "KB_DOCUMENT_NOT_FOUND" });
      return;
    }

    await client.from("knowledge_documents").update({ status: "parsing", message_code: "KB_PARSING", updated_at: new Date().toISOString() }).eq("id", documentId);

    // 下载
    const { data: blob, error: downloadError } = await client.storage.from("knowledge-documents").download(doc.storage_path as string);
    if (downloadError || !blob) {
      await fail("KB_DOWNLOAD_FAILED", "文件下载失败。");
      return;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    // 校验 checksum 与大小
    const sha = createHash("sha256").update(buffer).digest("hex");
    if (sha.toLowerCase() !== (doc.checksum_sha256 as string).toLowerCase()) {
      await fail("KB_CHECKSUM_MISMATCH", "文件校验和不一致，可能上传不完整。");
      return;
    }
    if (buffer.byteLength !== (doc.size_bytes as number)) {
      await fail("KB_SIZE_MISMATCH", "文件大小与声明不一致。");
      return;
    }

    // 解析
    await client.from("knowledge_documents").update({ status: "chunking", message_code: "KB_CHUNKING", updated_at: new Date().toISOString() }).eq("id", documentId);
    let parsed: { text: string; pageCount: number | null };
    try {
      parsed = await parseDocument(buffer, doc.mime_type as string);
    } catch {
      await fail("KB_PARSE_FAILED", "文档解析失败（可能是扫描件或格式损坏）。");
      return;
    }
    const cleaned = parsed.text.replace(/\u0000/g, "").trim();
    if (cleaned.length < 10) {
      await fail("KB_NO_TEXT", "未提取到可用文本（可能是图片型 PDF）。");
      return;
    }

    // 切块 + 落库（先清旧版本，再写新）
    const chunks = chunkText(cleaned);
    await client.from("knowledge_chunks").delete().eq("document_id", documentId).eq("document_version", doc.version as number);
    const chunkRows = chunks.map((chunk, index) => ({
      user_id: doc.user_id,
      knowledge_base_id: knowledgeBaseId,
      document_id: documentId,
      document_version: doc.version as number,
      chunk_index: index,
      content: chunk.content,
      source_locator: chunk.locator,
      metadata: { file_name: doc.file_name },
    }));
    const { error: chunkError } = await client.from("knowledge_chunks").insert(chunkRows);
    if (chunkError) {
      await fail("KB_CHUNK_WRITE_FAILED", `分块写入失败：${chunkError.message}`);
      return;
    }

    // validating → ready
    const { error: validatingError } = await client.from("knowledge_documents").update({
      status: "validating",
      message_code: "KB_VALIDATING",
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);
    if (validatingError) {
      await fail("KB_STATUS_UPDATE_FAILED", `状态更新失败：${validatingError.message}`);
      return;
    }
    const { error: readyError } = await client.from("knowledge_documents").update({
      status: "ready",
      message_code: "KB_READY",
      chunk_count: chunks.length,
      page_count: parsed.pageCount,
      error_code: null,
      updated_at: new Date().toISOString(),
    }).eq("id", documentId);
    if (readyError) {
      await fail("KB_STATUS_UPDATE_FAILED", `状态更新失败：${readyError.message}`);
      return;
    }

    // 更新知识库统计
    const { data: kb } = await client.from("knowledge_bases").select("id").eq("id", knowledgeBaseId).maybeSingle();
    if (kb) {
      const { count: total } = await client.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("knowledge_base_id", knowledgeBaseId);
      const { count: ready } = await client.from("knowledge_documents").select("id", { count: "exact", head: true }).eq("knowledge_base_id", knowledgeBaseId).eq("status", "ready");
      const nextStatus = (ready ?? 0) > 0 ? "ready" : "processing";
      await client.from("knowledge_bases").update({
        status: nextStatus,
        document_count: total ?? 0,
        ready_document_count: ready ?? 0,
        selectable: (ready ?? 0) > 0,
        updated_at: new Date().toISOString(),
      }).eq("id", knowledgeBaseId);
    }

    await finishJob(pool, {
      jobId: job.id,
      userId: job.user_id,
      status: "completed",
      stage: "validating",
      terminal: true,
      progress: 100,
      messageCode: "KB_INGEST_COMPLETED",
      result: { document_id: documentId, chunks: chunks.length, page_count: parsed.pageCount },
    });
  } catch (error) {
    await fail("KB_INGEST_ERROR", error instanceof Error ? error.message : "未知错误");
  }
}
