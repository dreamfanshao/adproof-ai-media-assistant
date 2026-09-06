// T07 Phase 3 临时集成测试：HTTP API 全链路（验证后删除）
// 流程：建项目 → 解析规则 → 建检索任务 → 手动跑 Worker 执行器 → 查达人列表 → 更新状态 → SSE 事件
import { readFileSync } from "node:fs";
import http from "node:http";
import { buildApp } from "../../../server/src/app.js";
import { loadServerConfig } from "../../../server/src/config.js";
import { createWorkerClient, createWorkerPool, claimSearchJob } from "../../../worker/src/xhs-db.js";
import { runCreatorSearchJob } from "../../../worker/src/xhs-search-executor.js";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const config = loadServerConfig(env);
if (!config.databaseUrl) throw new Error("DATABASE_URL missing");

// 取已连接会话用户作为测试用户（Worker 需要真实会话）
const { createClient } = await import("@supabase/supabase-js");
const probeClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey!, { auth: { persistSession: false } });
const { data: sessionRows } = await probeClient.from("platform_sessions").select("user_id").eq("status", "connected").limit(1);
const testUserId = sessionRows?.[0]?.user_id as string;
if (!testUserId) throw new Error("no connected session user");

const app = await buildApp({
  config,
  logger: false,
  authVerifier: { verify: async () => ({ userId: testUserId, email: "test@adproof.local" }) },
});
const server = app.server;
await app.ready();
await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
const auth = { Authorization: `Bearer test-jwt` };

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: response.status, json, text };
}

const pool = createWorkerPool({ ...env, DATABASE_URL: config.databaseUrl } as never);
const workerClient = createWorkerClient({ ...env, DATABASE_URL: config.databaseUrl } as never);
let projectId = "";
let taskId = "";

try {
  // 1. 建项目
  const project = await api("POST", "/projects", { name: "T07-P3-集成测试", product_name: "玻尿酸" });
  console.log("1) POST /projects ->", project.status, (project.json as any)?.data?.id ? "ok" : JSON.stringify(project.json));
  projectId = (project.json as any)?.data?.id;

  // 2. 解析规则
  const parsed = await api("POST", `/projects/${projectId}/search-rules:parse`, { query_text: "粉丝<1500、活跃度较高、做过光子嫩肤或有雀斑困扰" });
  const rule = (parsed.json as any)?.data;
  console.log("2) parse ->", parsed.status, JSON.stringify({ hard: rule?.hard_filters, semantic: rule?.semantic_conditions?.map((c: any) => `${c.id}:${c.type}:${c.terms.join("/")}`), ranking: rule?.ranking, limit: rule?.limit, ambiguities: rule?.ambiguities }));

  // 3. 建检索任务
  const created = await api("POST", `/projects/${projectId}/search-tasks`, { query_text: "粉丝<1500、活跃度较高、做过光子嫩肤或有雀斑困扰", confirmed_rule: rule, target_count: 3 });
  console.log("3) POST search-tasks ->", created.status, JSON.stringify((created.json as any)?.data ? { id: (created.json as any).data.id?.slice(0, 8), status: (created.json as any).data.status } : created.json));
  taskId = (created.json as any)?.data?.id;

  // 4. Worker 执行器手动领取并执行（真实采集，约 1-2 分钟）
  console.log("4) running worker executor...");
  const job = await claimSearchJob(pool, "phase3-integration");
  if (!job) throw new Error("claim failed");
  await runCreatorSearchJob({ ...env, DATABASE_URL: config.databaseUrl } as never, workerClient, pool, job);
  const taskView = await api("GET", `/search-tasks/${taskId}`);
  console.log("   task ->", JSON.stringify({ status: (taskView.json as any)?.data?.status, persisted: (taskView.json as any)?.data?.persisted_count, model: (taskView.json as any)?.data?.model_version }));

  // 5. 达人列表
  const creators = await api("GET", `/projects/${projectId}/creators`);
  const list = (creators.json as any)?.data ?? [];
  console.log("5) creators ->", creators.status, "count=", list.length, JSON.stringify(list.map((c: any) => ({ nick: c.creators?.nickname, score: c.match_score, decision: c.decision_status }))));

  // 6. 更新达人状态
  const firstCreator = list[0];
  if (firstCreator) {
    const updated = await api("PATCH", `/project-creators/${firstCreator.id}`, { decision_status: "selected" });
    console.log("6) PATCH creator ->", updated.status, JSON.stringify((updated.json as any)?.data ? { id: (updated.json as any).data.id?.slice(0, 8), decision: (updated.json as any).data.decision_status } : updated.json));
  }

  // 7. SSE 事件（打开读首个事件后关闭）
  console.log("7) SSE /tasks/{id}/events ->");
  await new Promise<void>((resolve) => {
    const req = http.get(`${base}/tasks/${taskId}/events`, { headers: auth }, (res) => {
      console.log("   SSE status:", res.statusCode);
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        if (buffer.includes("\n\n")) {
          console.log("   SSE first event:", buffer.split("\n\n")[0].replace(/\n/g, " | "));
          req.destroy();
          resolve();
        }
      });
    });
    req.setTimeout(15_000, () => { req.destroy(); resolve(); });
  });
} finally {
  await app.close().catch(() => undefined);
  // 清理测试数据
  const links = await workerClient.from("project_creators").select("creator_id").eq("project_id", projectId);
  const creatorIds = (links.data ?? []).map((l) => l.creator_id);
  if (creatorIds.length) {
    await workerClient.from("project_creators").delete().eq("project_id", projectId);
    await workerClient.from("creators").delete().in("id", creatorIds);
  }
  if (taskId) await workerClient.from("search_tasks").delete().eq("id", taskId);
  await pool.query("delete from private.job_events where user_id = $1", [testUserId]).catch(() => undefined);
  await pool.query("delete from private.jobs where user_id = $1", [testUserId]).catch(() => undefined);
  if (projectId) await workerClient.from("projects").delete().eq("id", projectId);
  await pool.end();
  console.log("CLEANED");
}
