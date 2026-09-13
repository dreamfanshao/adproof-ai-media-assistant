// Bounded live validation. Reads an existing task, never inserts search results.
// Makes up to eight real account-detail and AI requests (provider billing applies).
import { createWorkerPool } from "../worker/src/xhs-db.js";
import { createPostgresRedfoxCredentialStore } from "../server/src/services/redfox-credential-service.js";
import { RedfoxXhsClient, type RedfoxNoteCandidate } from "../worker/src/redfox-xhs-client.js";
import { OrderedPrefetch } from "../worker/src/ordered-prefetch.js";
import { analyzeNote, creatorSemanticAnalysisQuery } from "../worker/src/redfox-search-executor.js";
import type { AgentPlan } from "../agent/skills/types.js";

const taskId = process.argv[2];
if (!taskId || !/^[\da-f-]{36}$/i.test(taskId)) throw new Error("Pass an explicit search task UUID");
const pool = createWorkerPool(process.env as never);
try {
  const { rows } = await pool.query(`select pc.user_id, pc.analysis_json, c.platform_creator_id,
    c.nickname, c.handle, c.profile_url, s.query_text, s.confirmed_rule
    from public.project_creators pc join public.creators c on c.id=pc.creator_id
    join public.search_tasks s on s.id=pc.search_task_id where s.id=$1 order by pc.id limit 8`, [taskId]);
  if (!rows.length) throw new Error("No saved candidates");
  const store = createPostgresRedfoxCredentialStore(pool, process.env.XHS_SESSION_ENCRYPTION_KEY!);
  const apiKey = await store.resolve(rows[0].user_id) || process.env.REDFOX_API_KEY || "";
  const client = new RedfoxXhsClient({ apiKey, searchPath: "/story/api/xhs/ability/searchWork", maxRetries: 0 });
  const plan: AgentPlan = { planner: "deterministic-fallback", steps: [
    { id: "account", capabilityType: "skill", capabilityId: "creator_personal_account_assessment", purpose: "账号判断" },
    { id: "experience", capabilityType: "skill", capabilityId: "creator_experience_evidence", purpose: "经历证据" },
    { id: "match", capabilityType: "skill", capabilityId: "creator_semantic_matching", purpose: "语义匹配" },
  ] };
  const started = Date.now();
  let totalCandidateMs = 0;
  let completed = 0;
  const prefetch = new OrderedPrefetch(rows, 4, async (row) => {
    const start = Date.now();
    const note: RedfoxNoteCandidate = {
      userId: row.platform_creator_id, noteId: row.analysis_json.note_id, nickname: row.nickname,
      handle: row.handle, profileUrl: row.profile_url, raw: {}, noteType: "image",
      title: row.analysis_json.posts?.[0]?.title ?? "", text: row.analysis_json.note_text ?? "",
      imageUrls: row.analysis_json.imageUrls ?? [], likes: row.analysis_json.posts?.[0]?.likes ?? null, interaction: null,
    };
    const hydration = await client.hydrateCreatorProfile(note, { includeNoteDetail: false, includePostedNotes: false });
    const profileMs = Date.now() - start;
    if (!hydration.profile || hydration.accountDetailError) throw new Error("Profile validation failed");
    const analysis = await analyzeNote(creatorSemanticAnalysisQuery(row.query_text, row.confirmed_rule), note, "redfox", plan, hydration.profile);
    const totalMs = Date.now() - start;
    totalCandidateMs += totalMs;
    if (analysis.analysisComplete) completed += 1;
    return { name: row.nickname, followers: hydration.profile.fields.followers, profileMs, aiMs: totalMs - profileMs, completed: analysis.analysisComplete, matched: analysis.matched };
  });
  for (let index = 0; index < rows.length; index += 1) console.log(JSON.stringify(await prefetch.take(index)));
  console.log(JSON.stringify({ samples: rows.length, completed, wallMs: Date.now() - started, sumCandidateMs: totalCandidateMs, metrics: client.getMetrics() }));
} finally { await pool.end(); }
