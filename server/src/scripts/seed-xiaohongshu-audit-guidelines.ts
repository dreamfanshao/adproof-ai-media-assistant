import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DOCUMENT_RELATIVE_PATH = "docs/project-docs/01-输入素材/02-法规与规则/小红书内容审核依据_2026-08-30.md";
const DOCUMENT_FILE_NAME = "小红书内容审核依据_2026-08-30.md";
const SOURCE_URL = "https://pgy.xiaohongshu.com/help/home";
const PUBLIC_KB_NAME = "公共内容审核规则库（广告法与小红书规则）";
const PUBLIC_KB_DESCRIPTION = "平台维护的只读公共规则库，包含广告法核心条款与小红书社区、商业内容、医美和化妆品审核依据。";

type Chunk = { locator: string; content: string };
type SeedClient = ReturnType<typeof createClient<any>>;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing environment variable: ${name}`);
  return value;
}

function parseChunks(markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  const pattern = /<!-- KB-CHUNK:\s*([A-Z0-9-]+)\s*-->\s*([\s\S]*?)(?=<!-- KB-CHUNK:|$)/g;
  for (const match of markdown.matchAll(pattern)) {
    const locator = match[1]?.trim();
    const content = match[2]?.trim();
    if (locator && content) chunks.push({ locator, content });
  }
  if (chunks.length === 0) throw new Error("no KB chunks found in markdown");
  if (new Set(chunks.map((chunk) => chunk.locator)).size !== chunks.length) throw new Error("duplicate KB chunk locator");
  return chunks;
}

async function refreshKnowledgeBaseStats(client: SeedClient, kbId: string): Promise<void> {
  const { data, error } = await client
    .from("knowledge_documents")
    .select("id,status")
    .eq("knowledge_base_id", kbId);
  if (error) throw new Error(`list public documents: ${error.message}`);

  const documents = (data ?? []) as Array<{ id: string; status: string }>;
  const documentCount = documents?.length ?? 0;
  const readyDocumentCount = documents?.filter((document) => document.status === "ready").length ?? 0;
  const { error: updateError } = await client
    .from("knowledge_bases")
    .update({
      name: PUBLIC_KB_NAME,
      description: PUBLIC_KB_DESCRIPTION,
      status: readyDocumentCount > 0 ? "ready" : "empty",
      document_count: documentCount,
      ready_document_count: readyDocumentCount,
      selectable: readyDocumentCount > 0,
      source_url: SOURCE_URL,
      updated_at: new Date().toISOString(),
    })
    .eq("id", kbId);
  if (updateError) throw new Error(`refresh public KB: ${updateError.message}`);
}

async function main(): Promise<void> {
  const client = createClient<any>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const documentPath = resolve(process.cwd(), DOCUMENT_RELATIVE_PATH);
  const markdown = readFileSync(documentPath, "utf8");
  const chunks = parseChunks(markdown);
  const checksum = createHash("sha256").update(markdown, "utf8").digest("hex");

  const { data: existingKb, error: findKbError } = await client
    .from("knowledge_bases")
    .select("id,version")
    .eq("scope", "public_law")
    .maybeSingle();
  if (findKbError) throw new Error(`find public KB: ${findKbError.message}`);

  let kbId: string;
  let kbVersion = 1;
  if (existingKb) {
    kbId = existingKb.id as string;
    kbVersion = (existingKb.version as number | null) ?? 1;
  } else {
    const { data: kb, error } = await client
      .from("knowledge_bases")
      .insert({
        scope: "public_law",
        name: PUBLIC_KB_NAME,
        description: PUBLIC_KB_DESCRIPTION,
        source_url: SOURCE_URL,
      })
      .select("id,version")
      .single();
    if (error) throw new Error(`create public KB: ${error.message}`);
    kbId = kb.id as string;
    kbVersion = (kb.version as number | null) ?? 1;
  }

  const { data: existingDocument, error: findDocumentError } = await client
    .from("knowledge_documents")
    .select("id")
    .eq("knowledge_base_id", kbId)
    .eq("checksum_sha256", checksum)
    .maybeSingle();
  if (findDocumentError) throw new Error(`find public document: ${findDocumentError.message}`);

  if (existingDocument) {
    await refreshKnowledgeBaseStats(client, kbId);
    console.log(`SEED SKIPPED: document already exists (${existingDocument.id})`);
    return;
  }

  const { data: document, error: documentError } = await client
    .from("knowledge_documents")
    .insert({
      knowledge_base_id: kbId,
      file_name: DOCUMENT_FILE_NAME,
      storage_path: "seeded/xiaohongshu-audit-guidelines/2026-08-30.md",
      mime_type: "text/markdown",
      size_bytes: Buffer.byteLength(markdown, "utf8"),
      checksum_sha256: checksum,
      status: "ready",
      version: 1,
      chunk_count: chunks.length,
      message_code: "PUBLIC_KB_SEEDED",
    })
    .select("id")
    .single();
  if (documentError) throw new Error(`create public document: ${documentError.message}`);

  const sourceUrls = [
    "https://pgy.xiaohongshu.com/help/detail?id=6495c527d1eedeeb48fb18b1f875650e&userType=4",
    "https://pgy.xiaohongshu.com/help/detail?id=1eda0a065dd894063c2e029a49e8f6a1&userType=4",
    "https://pgy.xiaohongshu.com/help/home",
    "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_5474cf75173c45d6a0379730fb4e8d97.html",
    "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_d93a579afd45413e8576e4623fab348f.html",
    "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/bgt/art/2023/art_9f8b70e79a2242df96c6c290a0ac425b.html",
    "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_6584dc1c94c2408db7c73f0b5e3d225a.html",
  ];
  const { error: chunkError } = await client.from("knowledge_chunks").insert(
    chunks.map((chunk, index) => ({
      knowledge_base_id: kbId,
      document_id: document.id,
      document_version: 1,
      chunk_index: index,
      content: chunk.content,
      source_locator: chunk.locator,
      metadata: {
        document_title: "小红书内容审核依据（公共知识库版）",
        compiled_at: "2026-08-30",
        official_sources: sourceUrls,
        source_locator: chunk.locator,
        rule_scope: "xiaohongshu_content_audit",
      },
    })),
  );
  if (chunkError) throw new Error(`insert public chunks: ${chunkError.message}`);

  const { error: versionError } = await client
    .from("knowledge_bases")
    .update({ version: kbVersion + 1 })
    .eq("id", kbId);
  if (versionError) throw new Error(`update public KB version: ${versionError.message}`);

  await refreshKnowledgeBaseStats(client, kbId);
  console.log(
    `SEED OK: kb=${kbId.slice(0, 8)} doc=${String(document.id).slice(0, 8)} chunks=${chunks.length} checksum=${checksum.slice(0, 12)}`,
  );
}

main().catch((error) => {
  console.error("SEED FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
