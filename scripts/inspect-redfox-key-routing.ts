import { createHash } from "node:crypto";
import { createWorkerPool } from "../worker/src/xhs-db.js";
import { createPostgresRedfoxCredentialStore } from "../server/src/services/redfox-credential-service.js";
import { createRedfoxXhsClient } from "../worker/src/redfox-xhs-client.js";

function fingerprint(value: string | undefined | null): string | null {
  return value ? createHash("sha256").update(value.trim()).digest("hex").slice(0, 10).toUpperCase() : null;
}

const encryptionKey = process.env.XHS_SESSION_ENCRYPTION_KEY;
if (!process.env.DATABASE_URL || !encryptionKey) throw new Error("DATABASE_URL/XHS_SESSION_ENCRYPTION_KEY not configured");

const pool = createWorkerPool(process.env as never);
const latest = await pool.query<{ id: string; user_id: string; created_at: Date; project_id: string; query_text: string }>(
  "select id::text, user_id::text, created_at, payload->>'project_id' as project_id, payload->>'query_text' as query_text from private.jobs where type='creator_search' order by created_at desc limit 1",
);
const activeJobs = await pool.query<{ count: string }>(
  "select count(*)::text as count from private.jobs where terminal=false and status in ('queued','running')",
);
const job = latest.rows[0];
if (!job) throw new Error("No creator_search job found");

const store = createPostgresRedfoxCredentialStore(pool, encryptionKey);
const status = await store.status(job.user_id);
const resolved = await store.resolve(job.user_id);
const storedFingerprint = status.fingerprint;
const resolvedFingerprint = fingerprint(resolved);
const systemFingerprint = fingerprint(process.env.REDFOX_API_KEY);
let probe: Record<string, unknown> | null = null;
if (process.argv.includes("--probe")) {
  const effectiveKey = resolved ?? process.env.REDFOX_API_KEY;
  if (!effectiveKey) throw new Error("No effective RedFox API key");
  const redfox = createRedfoxXhsClient({
    ...process.env,
    REDFOX_API_KEY: effectiveKey,
    REDFOX_MAX_RETRIES: "0",
    REDFOX_MAX_REQUESTS_PER_SEARCH: "20",
  });
  try {
    const payload = await redfox.searchNotes("光子嫩肤 体验 日记", 1);
    probe = {
      ok: true,
      effectiveFingerprint: fingerprint(effectiveKey),
      endpoint: process.env.REDFOX_CREATOR_SEARCH_PATH ?? "/story/api/xhs/ability/searchWork",
      responseFields: Object.keys(payload).slice(0, 12),
      metrics: redfox.getMetrics(),
    };
  } catch (error) {
    probe = {
      ok: false,
      effectiveFingerprint: fingerprint(effectiveKey),
      endpoint: process.env.REDFOX_CREATOR_SEARCH_PATH ?? "/story/api/xhs/ability/searchWork",
      error: error instanceof Error ? error.message : String(error),
      metrics: redfox.getMetrics(),
    };
  }
}

console.log(JSON.stringify({
  latestJobId: job.id,
  activeJobCount: Number(activeJobs.rows[0]?.count ?? 0),
  projectId: job.project_id,
  queryText: job.query_text,
  jobCreatedAt: new Date(job.created_at).toISOString(),
  userIdentityHash: fingerprint(job.user_id),
  credentialConfigured: status.configured,
  credentialUpdatedAt: status.updatedAt,
  storedFingerprint,
  resolvedFingerprint,
  systemFingerprint,
  routingSource: resolved ? "user" : process.env.REDFOX_API_KEY ? "system" : "none",
  storedCipherIntegrityOk: Boolean(storedFingerprint && storedFingerprint === resolvedFingerprint),
  userKeyEqualsSystemKey: Boolean(resolvedFingerprint && resolvedFingerprint === systemFingerprint),
  userKeyShape: resolved ? {
    length: resolved.length,
    containsWhitespace: /\s/.test(resolved),
    startsWithBearer: /^Bearer\s+/i.test(resolved),
    hasWrappingQuotes: (/^".*"$/s.test(resolved) || /^'.*'$/s.test(resolved)),
    printableAsciiOnly: /^[\x21-\x7E]+$/.test(resolved),
  } : null,
  probe,
}, null, 2));

await pool.end();
