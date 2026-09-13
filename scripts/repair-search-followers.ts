// Usage: node --import tsx --env-file=.env.local scripts/repair-search-followers.ts <search-task-id> [--apply]
// Reads only missing counts for this task; never prints credentials or alters
// decisions/scores. Dry-run by default. The real upstream lookup may be billed.
import { createWorkerPool } from "../worker/src/xhs-db.js";
import { createPostgresRedfoxCredentialStore } from "../server/src/services/redfox-credential-service.js";
import { RedfoxXhsClient, normalizeProfile } from "../worker/src/redfox-xhs-client.js";

const taskId = process.argv[2];
if (!taskId || !/^[\da-f-]{36}$/i.test(taskId)) throw new Error("Pass an explicit search task UUID");
const apply = process.argv.includes("--apply");
const pool = createWorkerPool(process.env as never);
try {
  const { rows } = await pool.query(`select pc.id, pc.user_id, pc.creator_id, c.platform_creator_id,
    c.nickname, pc.followers from public.project_creators pc join public.creators c on c.id=pc.creator_id
    where pc.search_task_id=$1 and pc.followers is null order by pc.id`, [taskId]);
  const store = createPostgresRedfoxCredentialStore(pool, process.env.XHS_SESSION_ENCRYPTION_KEY!);
  const clients = new Map<string, RedfoxXhsClient>();
  for (const row of rows) {
    let client = clients.get(row.user_id);
    if (!client) {
      const apiKey = await store.resolve(row.user_id) || process.env.REDFOX_API_KEY || "";
      client = new RedfoxXhsClient({ apiKey, searchPath: "/story/api/xhs/ability/searchWork", maxRetries: 0 });
      clients.set(row.user_id, client);
    }
    const started = Date.now();
    try {
      const payload = await client.getUserInfo(row.platform_creator_id);
      const raw = (payload.data ?? payload.result ?? payload) as Record<string, unknown>;
      // No fallback identity here: require the provider to identify this account.
      const profile = normalizeProfile(raw);
      if (!profile || profile.ref.platformCreatorId !== row.platform_creator_id || profile.fields.followers === null) {
        console.log(JSON.stringify({ id: row.id, name: row.nickname, status: "unverified_or_missing" }));
        continue;
      }
      let updated = 0;
      if (apply) {
        const result = await pool.query(`update public.project_creators set followers=$1,
          field_warnings=coalesce(field_warnings, '[]'::jsonb) - 'FOLLOWERS_MISSING'
          where id=$2 and user_id=$3 and followers is null`, [profile.fields.followers, row.id, row.user_id]);
        updated = result.rowCount ?? 0;
      }
      console.log(JSON.stringify({ id: row.id, name: row.nickname, followers: profile.fields.followers, updated, durationMs: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({ id: row.id, name: row.nickname, status: "upstream_error", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: rows.length }));
} finally { await pool.end(); }
