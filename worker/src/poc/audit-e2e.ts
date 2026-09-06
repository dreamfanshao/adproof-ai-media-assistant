// T08 Phase 3 临时集成测试：创建审核 → 提交 → 执行 content_audit → 验证风险项（验证后删除）
import { readFileSync } from "node:fs";
import { buildApp } from "../../../server/src/app.js";
import { loadServerConfig } from "../../../server/src/config.js";
import { createClient } from "@supabase/supabase-js";
import { createWorkerClient, createWorkerPool, claimSearchJob } from "../xhs-db.js";
import { runContentAuditJob } from "../audit-executor.js";

const env: Record<string, string> = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].trim();
}
const config = loadServerConfig(env);

const TEST_EMAIL = "audit-test@adproof.local";
const admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey!, { auth: { persistSession: false } });
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const found = list.users.find((u) => u.email === TEST_EMAIL);
const { data: created } = found ? { data: { user: found } } : await admin.auth.admin.createUser({ email: TEST_EMAIL, password: "AuditTest-2026", email_confirm: true });
const userId = created!.user.id;
console.log("test user:", userId.slice(0, 8));

const app = await buildApp({ config, logger: true, authVerifier: { verify: async () => ({ userId, email: TEST_EMAIL }) } });
await app.ready();
const server = app.server;
await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;
const auth = { Authorization: "Bearer test", "Content-Type": "application/json" };
const workerClient = createWorkerClient({ ...env, DATABASE_URL: config.databaseUrl } as never);
const workerPool = createWorkerPool({ ...env, DATABASE_URL: config.databaseUrl } as never);

let taskId = "";
try {
  const draft = await (await fetch(`${base}/audit-tasks`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ title: "玻尿酸新品推广文案", body: "全网最低价、顶级品质，一针见效，根治色斑，100% 有效，研究显示效果显著。" }),
  })).json();
  taskId = draft.data.id;
  console.log("1) create draft ->", taskId.slice(0, 8), "status=", draft.data.status);

  const submittedRes = await fetch(`${base}/audit-tasks/${taskId}/submit`, { method: "POST", headers: auth, body: "{}" });
  const submitted = await submittedRes.json();
  if (!submittedRes.ok) {
    console.log("2) submit FAILED:", submittedRes.status, JSON.stringify(submitted));
  } else {
    console.log("2) submit ->", submitted.data.status, "job=", (submitted.data.task_id ?? "").slice(0, 8));
  }

  if (submittedRes.ok) {
    const job = await claimSearchJob(workerPool, "audit-e2e", "content_audit");
    if (!job) throw new Error("claim content_audit failed");
    await runContentAuditJob({ ...env, DATABASE_URL: config.databaseUrl } as never, workerClient, workerPool, job);

    const result = await (await fetch(`${base}/audit-tasks/${taskId}`, { headers: auth })).json();
    const task = result.data;
    console.log("3) result ->", JSON.stringify({
      status: task.status, overall_risk: task.overall_risk, error_code: task.error_code, message_code: task.message_code,
      risk_counts: task.risk_counts, recommended_action: task.recommended_action, findings: (task.findings ?? []).length,
    }));
    for (const f of task.findings ?? []) {
      console.log(`   finding: ${f.risk_level} ${f.category} | ${f.explanation} | 依据:${f.source_locator} | 建议:${f.suggestion}`);
    }
    const { data: warnings } = await workerClient.from("audit_coverage_warnings").select("code").eq("audit_task_id", taskId);
    console.log("   warnings:", JSON.stringify((warnings ?? []).map((w) => w.code)));
    const { data: snapshots } = await workerClient.from("audit_knowledge_snapshots").select("scope,name").eq("audit_task_id", taskId);
    console.log("   snapshots:", JSON.stringify(snapshots));
  }
} finally {
  if (taskId) await fetch(`${base}/audit-tasks/${taskId}`, { method: "DELETE", headers: { Authorization: "Bearer test" } }).catch(() => undefined);
  const clean = async (table: string, col = "user_id"): Promise<void> => {
    try { await workerClient.from(table).delete().eq(col, userId); } catch { /* ignore */ }
  };
  await clean("audit_knowledge_snapshots");
  await clean("audit_findings");
  await clean("audit_coverage_warnings");
  await clean("audit_assets");
  await clean("audit_tasks");
  await workerPool.query("delete from private.job_events where user_id = $1", [userId]).catch(() => undefined);
  await workerPool.query("delete from private.jobs where user_id = $1", [userId]).catch(() => undefined);
  await workerPool.end();
  await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  await app.close().catch(() => undefined);
  console.log("CLEANED");
}
