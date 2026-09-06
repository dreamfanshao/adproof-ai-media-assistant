// T08 Phase 1 临时集成测试：知识库 → 上传 → 提交 → 入库执行 → 验证（验证后删除）
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildApp } from "../../../server/src/app.js";
import { loadServerConfig } from "../../../server/src/config.js";
import { createClient } from "@supabase/supabase-js";
import { createWorkerClient, createWorkerPool, claimSearchJob } from "../xhs-db.js";
import { runKnowledgeIngestJob } from "../knowledge-ingest-executor.js";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}
const config = loadServerConfig(env);

const TEST_EMAIL = "kb-test@adproof.local";
const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey!, { auth: { persistSession: false } });
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const found = list.users.find((u) => u.email === TEST_EMAIL);
const { data: created } = found ? { data: { user: found } } : await admin.auth.admin.createUser({ email: TEST_EMAIL, password: "KbTest-2026", email_confirm: true });
const userId = created!.user.id;
console.log("test user:", userId);

const app = await buildApp({ config, logger: false, authVerifier: { verify: async () => ({ userId, email: TEST_EMAIL }) } });
await app.ready();
const server = app.server;
await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
const auth = { Authorization: "Bearer test", "Content-Type": "application/json" };

const workerClient = createWorkerClient({ ...env, DATABASE_URL: config.databaseUrl } as never);
const workerPool = createWorkerPool({ ...env, DATABASE_URL: config.databaseUrl } as never);

const CONTENT = "第一条 平台达人内容合作须真实、客观。\n第二条 禁止使用绝对化用语，如最、第一、顶级、全网最低价。\n第三条 医疗功效表述须有科学依据，不得夸大。\n第四条 涉及用户评价的，须为真实体验。\n第五条 违反前述规则的，合作方应修改后重新送审。\n";
const contentBuf = Buffer.from(CONTENT, "utf8");
const checksum = createHash("sha256").update(contentBuf).digest("hex");

let kbId = "";
let documentId = "";
let jobId = "";

try {
  // 1. 建知识库
  const kb = await (await fetch(`${base}/knowledge-bases`, { method: "POST", headers: auth, body: JSON.stringify({ name: "T08-测试规则库", description: "集成测试" }) })).json();
  kbId = kb.data.id;
  console.log("1) create KB ->", kbId.slice(0, 8));

  // 2. 上传意图
  const intent = await (await fetch(`${base}/knowledge-bases/${kbId}/document-upload-intents`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ file_name: "规则.txt", mime_type: "text/plain", size_bytes: contentBuf.length, checksum_sha256: checksum }),
  })).json();
  console.log("2) upload intent ->", intent.data.method, "path=", intent.data.storage_path?.slice(0, 30));

  // 3. PUT 上传
  const put = await fetch(intent.data.upload_url, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: contentBuf });
  console.log("3) PUT upload ->", put.status, (await put.text()).slice(0, 200));

  // 4. 提交
  const commitRes = await fetch(`${base}/knowledge-bases/${kbId}/documents`, {
    method: "POST", headers: auth,
    body: JSON.stringify({
      upload_id: intent.data.upload_id, storage_path: intent.data.storage_path,
      file_name: "规则.txt", mime_type: "text/plain", size_bytes: contentBuf.length, checksum_sha256: checksum,
    }),
  });
  const commitBody = await commitRes.json();
  let committed = false;
  if (!commitRes.ok) {
    console.log("4) commit FAILED:", commitRes.status, JSON.stringify(commitBody));
  } else {
    const commit = commitBody;
    documentId = commit.data.id;
    jobId = commit.data.task_id;
    console.log("4) commit -> status=", commit.data.status, "job=", jobId.slice(0, 8));
    committed = true;
  }

  if (committed) {
    // 5. 手动执行入库 job（停守护进程期间独占）
    const job = await claimSearchJob(workerPool, "kb-e2e", "knowledge_ingest");
    if (!job) throw new Error("claim knowledge_ingest failed");
    await runKnowledgeIngestJob({ ...env, DATABASE_URL: config.databaseUrl } as never, workerClient, workerPool, job);

    // 6. 验证（pg 直查）
    const docRow = await workerPool.query("select status, chunk_count, page_count, error_code, message_code from knowledge_documents where id = $1", [documentId]);
    console.log("6) doc(pg) ->", JSON.stringify(docRow.rows[0] ?? null));
    const { data: chunks } = await workerClient.from("knowledge_chunks").select("chunk_index,content,source_locator").eq("document_id", documentId).order("chunk_index");
    console.log("   chunks:", chunks?.length, "first:", chunks?.[0]?.content?.slice(0, 40), "locator:", chunks?.[0]?.source_locator);
    const kbView = await (await fetch(`${base}/knowledge-bases/${kbId}`, { headers: auth })).json();
    console.log("   kb ->", JSON.stringify({ status: kbView.data.status, document_count: kbView.data.document_count, ready_count: kbView.data.ready_document_count, selectable: kbView.data.selectable }));
  }
} finally {
  // 清理
  if (documentId) await fetch(`${base}/knowledge-documents/${documentId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  if (kbId) await fetch(`${base}/knowledge-bases/${kbId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  await workerPool.query("delete from private.job_events where user_id = $1", [userId]).catch(() => undefined);
  await workerPool.query("delete from private.jobs where user_id = $1", [userId]).catch(() => undefined);
  await workerPool.end();
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  await app.close().catch(() => undefined);
  console.log("CLEANED");
}
