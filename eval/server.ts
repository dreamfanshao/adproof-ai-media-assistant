// 闂傚倸鍊搁崐椋庣矆娓氣偓楠炴牠顢曢敂钘変罕濠电姴锕ら悧鍡欑矆閸喓绠鹃柛鈩冾殜閻涙粓鏌?Eval / 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻濇繝鍌滃缂佲偓婢跺鍙忔俊鐐额嚙娴滄儳螖閻橀潧浠滄俊顐ｇ箞瀹曟椽鍩€椤掍降浜滈柟鍝勬娴滈箖姊虹€圭姵顥夋い锔炬暬閻涱喖顫滈埀顒勫箹瑜版帩鏁冮柕蹇婂墲閺嗘﹢姊虹拠鍙夋崳闁硅櫕鎹囬獮澶愭晬閸曨剙搴婇梺鍓插亖閸庨亶鎷戦悢琛″亾閸忓浜鹃梺鍛婂姦娴滅偤寮堕幖浣圭厵闁稿繗鍋愰弳姗€鏌涙繝鍐╃闁绘侗鍣ｉ崺鈧い鎺戝閳锋帒鈹戦悩鏌ヮ€楀ù婊勭矋缁绘稓浠﹂崒姘ｅ亾濠靛棛鏆︽い鏍剱閺佸秵鎱ㄥΟ璇茬闁逞屽墮濞硷繝寮诲☉銏犖ㄦい鏃傚帶椤晝绱撴担鎻掍壕婵犮垼鍩栭崝鏍偂閸愵喗鐓忓璺虹墕婵′粙鏌ｅ┑鎰偗闁哄矉绲介埞鎴﹀礋椤愮喎浜炬繝闈涱儏閽冪喖鏌曟繛鍨姉婵℃彃鐗婄换娑㈠幢濡搫顫庡┑鐐茬墑閸婃繈寮婚敐鍡樺劅闁靛繒濮村В鍫ユ⒑閸涘⊕顏呮櫠娴犲绀嗛柟鐑橆殔閻撴盯鏌涢幇鍓佸埌濞存粓绠栭弻銊モ攽閸℃侗鈧顭胯椤曆囨箒闂佺粯鎸告鎼佸焵椤掆偓濞尖€愁嚕?3081闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熺€电浠ч梻鍕閺岋繝宕橀妸銉㈠亾閼姐倗涓嶉柡鍐ㄧ墛閸婂爼鏌ｉ幇顓炵祷闁抽攱妫冮弻宥囩磼濡椿妫冮梺鍝勮閸婃牠骞堥妸鈺佺疀妞ゆ垼妫勬禍鐐節闂堟侗鍎忕紒鈧崒鐐寸厱闁靛鍨哄▍鍥╃棯閹规劖顥夐棁澶愭煥濠靛棙鍣洪柟顖氱墦閺岋紕鈧綆鍋嗛埊鏇犵磼缂佹娲寸€规洖鍚嬮幏鍛村川婵犲倹顏ら梻浣规た閸樺ジ藝椤栫偞绠掗梻浣侯焾缁绘宕戦幇鏉跨疇闁告侗鍨崇壕濂告煃瑜滈崜姘嚗閸曨剛绠鹃柣鎰靛墻濞兼棃姊绘担绛嬫綈闁稿骸纾竟鏇㈩敇閻斿憡鐝￠梻鍌氬€烽懗鍫曗€﹂崼鐕佹闁归棿绶￠弫瀣亜閹捐泛校妞ゎ偅娲熼弻锟犲礃閵娿儮鍋撻崷顓涘亾濮橆厽鐨戦柟鍙夌摃缁犳盯寮撮悩鐢靛姸闂?05闂?
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Fastify from "fastify";
import { createClient } from "@supabase/supabase-js";
import { runAllEvals } from "./runner.js";
import { RULE_PARSE_CASES, AUDIT_RULE_CASES, SEMANTIC_MATCH_CASES } from "./datasets.js";
import {
  loadAnnotations, saveAnnotations, loadSuggestions, saveSuggestions, loadRatings, saveRatings, loadAbTests, saveAbTests, loadSettings, saveSettings,
  type Annotation, type Suggestion, type ServiceRating, type AbTestRecord,
} from "./storage.js";
import {
  appendEvalBatchResult, createEvalBatch, deleteEvalCase, getEvalBatch, getEvalBatchResults,
  listEvalBatches, listEvalCases, qualityPassRate, seedEvalCases, summarizeStatuses, updateEvalBatch,
  upsertEvalCase, EVALUATOR_VERSION,
} from "./eval-v2.js";
import type { EvalBatchResult } from "./storage.js";
import { registerModuleRoutes } from "./module-routes.js";
import { moduleOverview } from "./module-eval.js";
import { registerModuleActionRoutes } from "./module-action-routes.js";
import { registerModelRoutes } from "./model-routes.js";
import { registerModuleAgentRoutes } from "./module-agent-routes.js";
import { getUsageOverview, readApiLogs, getApiLog } from "../server/src/services/usage-analytics.js";
import { updateModuleSkill } from "./module-admin.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.EVAL_PORT ?? 3081);

const feedbackAdminClient = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  : null;
// The Eval console is a local admin surface. Feedback can be viewed without a
// second token, but the endpoint remains loopback-only so user submissions are
// not exposed to other machines when the server is reachable on a LAN.
async function requireEvalAdmin(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) {
  const ip = request.ip.replace(/^::ffff:/, "");
  if (ip !== "127.0.0.1" && ip !== "::1") {
    return reply.code(403).send({ error: "意见反馈管理仅允许在本机后台访问。" });
  }
}

type FeedbackAdminRow = {
  id: string;
  user_id: string;
  category: string;
  title: string;
  description: string;
  page_path: string | null;
  status: string;
  priority: string;
  admin_reply: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

async function readFeedbackRows(): Promise<{ configured: boolean; rows: FeedbackAdminRow[] }> {
  if (!feedbackAdminClient) return { configured: false, rows: [] };
  const { data, error } = await feedbackAdminClient
    .from("feedback_tickets")
    .select("id,user_id,category,title,description,page_path,status,priority,admin_reply,created_at,updated_at,resolved_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { configured: true, rows: (data ?? []) as FeedbackAdminRow[] };
}

async function feedbackSummary() {
  try {
    const { configured, rows } = await readFeedbackRows();
    return {
      configured,
      total: rows.length,
      open: rows.filter((row) => row.status === "open").length,
      inProgress: rows.filter((row) => row.status === "in_progress").length,
      resolved: rows.filter((row) => row.status === "resolved" || row.status === "closed").length,
      bugs: rows.filter((row) => row.category === "bug").length,
    };
  } catch (error) {
    app.log.warn({ err: error }, "Feedback summary unavailable");
    return { configured: false, total: 0, open: 0, inProgress: 0, resolved: 0, bugs: 0 };
  }
}

const app = Fastify({ logger: true });
registerModuleRoutes(app);
registerModuleActionRoutes(app);
registerModelRoutes(app);
registerModuleAgentRoutes(app);

// 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柡澶嬪殮濞差亜围闁搞儻绲芥禍鐐叏濡厧甯舵鐐搭焽缁辨帡顢欑涵鐤惈濡ょ姷鍋為敃銏ゃ€佸▎鎴炲枂闁挎繂妫楅惁鍫曟⒒閸屾瑨鍏岀痪顓℃硾鍗遍柛娑欐綑閸屻劑鏌涢幘妤€鎳愰悞濂告⒑閸涘﹥澶勯柛銊╀憾閹繝寮撮悢铏诡啎闂佺硶鍓濋埣銈夘敂閸喎鈧爼鏌曟径娑滅濞存粍绮嶉妵鍕箛閳轰胶鍔撮梺绋垮濡啴寮?
app.get("/api/datasets", async () => {
  const annotations = loadAnnotations();
  const annotatedIds = new Set(annotations.map((a) => a.id));
  return {
    data: {
      rule_parse: RULE_PARSE_CASES.map((c) => ({ id: c.id, input: c.input, expected: JSON.stringify(c.expect), note: c.note })),
      audit_rules: AUDIT_RULE_CASES.map((c) => ({ id: c.id, text: c.text, expectRule: c.expectRule, note: c.note })),
      semantic_match: SEMANTIC_MATCH_CASES.map((c) => ({ id: c.id, queryTerms: c.queryTerms, match: c.match, note: c.note, annotated: annotatedIds.has(c.id) })),
    },
    meta: { note: "Eval local service" },
  };
});

// 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柡澶嬪殮濞差亜围闁搞儻绲芥禍鐐叏濡厧甯舵鐐搭焽缁辨帡顢欑涵宄板闂侀€炲苯澧紒瀣浮閳ワ箓宕堕鈧悡婵嬫煛閸愶絽浜鹃梺闈涙搐鐎氫即鐛Ο鍏煎磯閺夌偟澧楅崺娑樷攽閻樻鏆柍褜鍓濆▍鏇㈠窗濮椻偓閺岋紕浠︾拠鎻掝瀳闂佸疇妫勯ˇ顖濈亽闂佺粯鎸哥花鍫曞矗閵忋垻纾介柛灞剧懄缁佺増銇勯弴鍡楁噽閻捇鏌涢锝嗙缂?+ 闂傚倸鍊风粈渚€骞栭位鍥敃閿曗偓閻ょ偓绻涢幋鐐╂（婵炲樊浜滄儫闂佸疇妗ㄩ懗鍫曞储閻戞绡€闂傚牊绋戦埀顒€顭烽垾锕傚醇閵夛箑鍓瑰┑掳鍊撻梽宥嗙濠婂牊鐓涚€广儱鍟俊璺ㄧ磼閻橆喖鍔滅紒?+ bad case + 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柡澶嬪殮濞差亜围闁搞儻绲芥禍鐐叏濡厧甯跺褍顕埀顒冾潐濞叉繈锝炴径鎰畾闁哄啫鐗嗘儫闂侀潧顧€鐎靛苯螞閻斿吋鈷戦柤濮愬€曢弸鎴︽煟閻旀潙鍔ら柍褜鍓氶崙褰掑闯閿濆棔绻嗛悗娑欘焽缁♀偓闂佹悶鍎崝搴ㄥ矗?
app.get("/api/evals", async () => {
  const suites = await runAllEvals();
  const total = suites.reduce((s, x) => s + x.total, 0);
  const passed = suites.reduce((s, x) => s + x.passed, 0);
  const review = suites.reduce((s, x) => s + x.cases.filter((c) => c.status === "REVIEW").length, 0);
  const failed = total - passed - review;
  const badCases = suites.flatMap((s) => s.cases.filter((c) => c.status === "FAIL" || (c.status === undefined && !c.pass)).map((c) => ({ suite: s.id, ...c })));
  const reviewCases = suites.flatMap((s) => s.cases.filter((c) => c.status === "REVIEW").map((c) => ({ suite: s.id, ...c })));
  const scoringMethods = ["exact_match", "cosine_similarity", "llm_as_judge", "human_eval"] as const;
  const settings = loadSettings();
  return {
    data: {
      generated_at: new Date().toISOString(),
      suites,
      summary: { total, passed, failed, review, pass_rate: passed + failed + review ? +(passed / (passed + failed + review)).toFixed(3) : 0, bad_count: badCases.length, review_count: reviewCases.length },
      bad_cases: badCases,
      review_cases: reviewCases,
      evaluator_version: EVALUATOR_VERSION,
      latest_batch: listEvalBatches()[0] ?? null,
      scoring_methods: [
        { id: "exact_match", name: "Exact match", desc: "Compare expected and actual output." },
        { id: "cosine_similarity", name: "Semantic similarity", desc: "Compare semantic similarity." },
        { id: "llm_as_judge", name: "LLM as Judge", desc: settings.llmBaseUrl || "Provider not configured" },
        { id: "human_eval", name: "Human review", desc: "Review by an operator." },
      ],
      llm_ready: Boolean((process.env.OPENAI_API_KEY ?? "") || settings.llmBaseUrl),
    },
  };
});

// 闂傚倸鍊搁崐宄懊归崶褜娴栭柕濞炬櫆閸ゅ嫰鏌ょ粙璺ㄤ粵婵炲懐濮垫穱濠囧Χ閸屾矮澹曢梻浣风串缁蹭粙鎮樺杈╃當闁绘梻鍘ч悞鍨亜閹哄棗浜惧銈嗘穿缁插墽绮嬮幒鏂哄亾閿濆簼绨介柛濠勫仱濮婃椽妫冨☉杈╁彋闂傚倸瀚€氼剟鍩?
app.get("/api/annotations", async () => {
  const annotations = loadAnnotations();
  const stats = {
    total: annotations.length,
    pending: annotations.filter((a) => a.status === "pending").length,
    reviewed: annotations.filter((a) => a.status === "reviewed").length,
    rejected: annotations.filter((a) => a.status === "rejected").length,
  };
  return { data: { stats, annotations } };
});

app.post("/api/annotations/save", async (request) => {
  const body = request.body as { annotations?: Annotation[] };
  if (!Array.isArray(body?.annotations)) return { data: { ok: false, error: "annotations must be an array" } };
  const existing = loadAnnotations();
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const item of body.annotations) {
    if (!item.id) continue;
    byId.set(item.id, { ...(byId.get(item.id) ?? item), ...item, updatedAt: new Date().toISOString() });
  }
  saveAnnotations([...byId.values()]);
  return { data: { ok: true, count: byId.size } };
});

app.post("/api/annotations/add", async (request) => {
  const body = request.body as { annotation?: Partial<Annotation> & { id: string } };
  if (!body?.annotation?.id) return { data: { ok: false, error: "annotation id is required" } };
  const existing = loadAnnotations();
  const item: Annotation = {
    id: body.annotation.id,
    caseId: body.annotation.caseId,
    batchId: body.annotation.batchId,
    reviewer: body.annotation.reviewer,
    suite: body.annotation.suite ?? "manual",
    input: body.annotation.input ?? "",
    systemOutput: body.annotation.systemOutput ?? "",
    scores: body.annotation.scores ?? { correctness: 1, relevance: 1, completeness: 1, safety: 1, tone: 1, overall: 1 },
    status: body.annotation.status ?? "pending",
    note: body.annotation.note ?? "",
    updatedAt: new Date().toISOString(),
  };
  const idx = existing.findIndex((a) => a.id === item.id);
  if (idx >= 0) existing[idx] = item; else existing.push(item);
  saveAnnotations(existing);
  return { data: { ok: true } };
});

// 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勯弸渚€鏌熼梻瀵割槮闁稿被鍔庨幉鎼佸棘鐠恒劍娈?JSONL
app.get("/api/export", async (request) => {
  const filter = (request.query as { filter?: string }).filter ?? "all";
  const annotations = loadAnnotations();
  const rows = filter === "reviewed" ? annotations.filter((a) => a.status === "reviewed") : annotations;
  const jsonl = rows.map((a) => JSON.stringify(a)).join("\n");
  return { data: { filter, count: rows.length, jsonl } };
});

// 闂傚倸鍊峰ù鍥敋瑜嶉湁闁绘垼妫勯弸渚€鏌熼梻瀵割槮闁稿被鍔庨幉鎼佸棘鐠恒劍娈?Bad Cases闂傚倸鍊搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿顑呴埞鎴︽偐閸欏顦╅梺绋款儏椤戝洨妲愰幒鏂哄亾閿濆骸浜介柛搴涘劦閺屾盯濡堕崱妯碱槹闂佺粯鎼╅崑濠傜暦閸洖唯闁靛鍎辫缂傚倸鍊烽悞锕傚礉閺嶎厹鈧倿鎮鹃弰鐮?suite,input,systemOutput,expected,note}]闂?
app.post("/api/import-bad-cases", async (request) => {
  const body = request.body as { cases?: Array<{ id: string; caseId?: string; batchId?: string; suite?: string; input?: string; systemOutput?: string; expected?: string; note?: string }> };
  if (!Array.isArray(body?.cases)) return { data: { ok: false, error: "cases must be an array" } };
  const existing = loadAnnotations();
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const c of body.cases) {
    if (!c.id) continue;
    const item: Annotation = {
      id: c.id,
      caseId: c.caseId ?? c.id,
      batchId: c.batchId,
      suite: c.suite ?? "imported",
      input: c.input ?? "",
      systemOutput: c.systemOutput ?? "",
      scores: { correctness: 1, relevance: 1, completeness: 1, safety: 1, tone: 1, overall: 1 },
      status: "pending",
      note: c.note ?? "从评测 Bad Case 导入",
      updatedAt: new Date().toISOString(),
    };
    byId.set(c.id, item);
  }
  saveAnnotations([...byId.values()]);
  return { data: { ok: true, count: byId.size } };
});

// 闂傚倸鍊搁崐宄懊归崶顒€违闁逞屽墴閺屾稓鈧綆鍋呯亸鐢告煟閵夘喕閭い銏★耿閹瑩寮堕幋鐑嗕槐缂傚倸鍊烽懗鑸垫叏閹呮殾闁汇垻顭堥悞鍨亜閹烘垵鈧憡绂掗鐐寸厱濠电姴鍟扮粻妯肩磼鏉堛劍灏い顐ｇ箖閿涙劕鈹戦崶銊︾彟闂傚倷绀侀幉鈩冪瑹濡ゅ懎绐楁慨妯挎硾閻撴繈鏌￠崘锝呬壕闂侀潧娲ょ€氫即鐛Ο鍏煎磯閺夌偟澧楅崺娑樷攽?
app.get("/api/suggestions", async () => {
  const suggestions = loadSuggestions();
  return { data: { suggestions } };
});
app.post("/api/suggestions/save", async (request) => {
  const body = request.body as { suggestions?: Suggestion[] };
  if (!Array.isArray(body?.suggestions)) return { data: { ok: false, error: "suggestions must be an array" } };
  saveSuggestions(body.suggestions.map((s) => ({ ...s, id: s.id || randomUUID(), createdAt: s.createdAt || new Date().toISOString() })));
  return { data: { ok: true } };
});

// 闂傚倸鍊峰ù鍥х暦閸偅鍙忕€规洖娲ㄩ惌鍡椕归敐鍫綈婵炲懐濮撮湁闁绘ê妯婇崕鎰版煕鐎ｅ吀閭柡灞剧洴閸╁嫰宕橀浣割潓闂備礁鎼幏瀣礈閻旂厧钃熸繛鎴欏灪閺呮粓鏌熼鍡楀閸氭┇-as-judge prompt + LLM 闂傚倸鍊搁崐鎼佸磹閻戣姤鍊块柨鏇楀亾妞ゎ厼鐏濊灒闁兼祴鏅濋悡瀣⒑閸撴彃浜濇繛鍙夛耿瀹曟垿顢旈崼鐔哄幈闂佹枼鏅涢崯浼村煀閺囥垺鐓?
// 统一 Eval 运营接口：评分、改进建议和 A/B 测试均写入本地数据，供运营中心追溯。
app.get("/api/ratings", async (request) => {
  const limit = Math.min(200, Math.max(1, Number((request.query as { limit?: string })?.limit ?? 100) || 100));
  const ratings = loadRatings().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { data: { ratings: ratings.slice(0, limit), total: ratings.length } };
});

app.post("/api/ratings", async (request, reply) => {
  const body = (request.body ?? {}) as Partial<ServiceRating>;
  const score = Number(body.score);
  if (!Number.isFinite(score) || score < 1 || score > 5) return reply.code(400).send({ data: { ok: false, error: "score 必须是 1-5" } });
  const item: ServiceRating = { id: body.id || `rating-${randomUUID().slice(0, 8)}`, runId: body.runId, caseId: body.caseId, score, comment: body.comment || "", input: body.input || "", output: body.output || "", createdAt: new Date().toISOString() };
  saveRatings([item, ...loadRatings().filter((x) => x.id !== item.id)]);
  if (score <= 2) {
    const suggestions = loadSuggestions();
    const suggestion: Suggestion = { id: `suggestion-${randomUUID().slice(0, 8)}`, source: "low-rating", title: `低分回复待改进（${score}/5）`, detail: `${item.comment || "请检查该回复"}${item.runId ? ` · runId=${item.runId}` : ""}`, status: "open", createdAt: item.createdAt };
    saveSuggestions([suggestion, ...suggestions]);
  }
  return reply.code(201).send({ data: { rating: item } });
});

app.get("/api/improvements", async (request) => {
  const limit = Math.min(200, Math.max(1, Number((request.query as { limit?: string })?.limit ?? 100) || 100));
  const improvements = loadSuggestions().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { data: { improvements: improvements.slice(0, limit), total: improvements.length } };
});

app.post("/api/improvements/generate-prompt", async (request, reply) => {
  const body = (request.body ?? {}) as { module?: string; skillId?: string; sourceRunId?: string; feedback?: string };
  const feedback = String(body.feedback || "").trim();
  if (!feedback) return reply.code(400).send({ data: { ok: false, error: "feedback 不能为空" } });
  const suggestion: Suggestion = { id: `suggestion-${randomUUID().slice(0, 8)}`, source: "manual", title: `${body.skillId || "Skill"} Prompt 改进草案`, detail: `针对 ${body.sourceRunId || "未指定运行"}：${feedback}。草案仅供预览，确认后才会应用。`, status: "open", createdAt: new Date().toISOString() };
  saveSuggestions([suggestion, ...loadSuggestions()]);
  const draft = `\n\n## 改进草案（待确认）\n- 针对问题：${feedback}\n- 输出必须引用可追溯证据，证据不足时返回 REVIEW。`;
  return reply.code(201).send({ data: { suggestion, draft, applied: false } });
});

app.post("/api/improvements/apply-prompt", async (request, reply) => {
  const body = (request.body ?? {}) as { module?: string; skillId?: string; prompt?: string; changeNote?: string };
  if (body.module !== "creators" && body.module !== "audit") return reply.code(400).send({ data: { ok: false, error: "module 必须是 creators 或 audit" } });
  if (!body.skillId || !String(body.prompt || "").trim()) return reply.code(400).send({ data: { ok: false, error: "skillId 和 prompt 不能为空" } });
  try {
    const skill = updateModuleSkill(body.module, body.skillId, { prompt: String(body.prompt) }, body.changeNote || "应用 Eval 改进建议");
    return { data: { applied: true, skill } };
  } catch (error) {
    return reply.code(400).send({ data: { ok: false, error: error instanceof Error ? error.message : String(error) } });
  }
});

app.get("/api/ab-tests", async () => ({ data: { tests: loadAbTests() } }));
app.post("/api/ab-tests", async (request, reply) => {
  const body = (request.body ?? {}) as Partial<AbTestRecord>;
  if (!body.name) return reply.code(400).send({ data: { ok: false, error: "name 不能为空" } });
  const item: AbTestRecord = { id: body.id || `ab-${randomUUID().slice(0, 8)}`, name: body.name, module: body.module, baseline: body.baseline, variant: body.variant, status: body.status || "draft", createdAt: new Date().toISOString() };
  saveAbTests([item, ...loadAbTests().filter((x) => x.id !== item.id)]);
  return reply.code(201).send({ data: { test: item } });
});
app.get("/api/settings", async () => {
  const settings = loadSettings();
  const env = { OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY ?? "") ? "configured" : "missing" };
  return { data: { settings, env } };
});
app.post("/api/settings/save", async (request) => {
  const body = request.body as { settings?: Partial<import("./storage.js").EvalSettings> };
  if (!body?.settings) return { data: { ok: false } };
  const current = loadSettings();
  saveSettings({ ...current, ...body.settings });
  return { data: { ok: true } };
});

// SnackOps 婵犵數濮烽。顔炬閺囥垹纾绘繛鎴欏焺閺佸嫰鏌涘☉鍗炵仚闁稿鎸搁埥澶愬箳閹惧褰嬮梻浣筋嚃閸燁偊宕惰椤旀劖绻涙潏鍓ф偧闁硅櫕鎹囧畷?EvalCase 缂傚倸鍊搁崐鎼佸磹閻戣姤鍤勯柤鎼佹涧閸ㄦ棃鎮楅棃娑欏暈妞ゎ偅娲熼弻锟犲炊閵夈儳浠肩紓浣哄У閻楁洟鍩為幋锔藉亹闁告瑥顦ˇ鈺呮⒑閸濆嫭濯奸柛鎾村哺楠炲牓濡搁妷搴ｅ枛瀹曠螖閳ь剟骞楅悽鍛娾拺闁告繂瀚ˉ婊呯磼缂佹ê濮嶅┑鈩冩尦楠炴帡骞嬮鐔峰厞婵＄偑鍊栫敮鎺椝囬鐐茬濞寸厧鐡ㄩ崑鈩冪節婵犲倸顏╂い搴㈢矒閹绠涢弮鍌涘櫘闂佸憡甯楃敮鈥澄涢崘銊㈡闁圭儤鎼╁鏃堟⒒娴ｇ鏆遍柣蹇撶墦瀵彃鈽夊▎鎴锤闂佽鍨庡畝鈧崬鐢告煟閻樿崵绱版繛鍜冪稻閺呭爼骞囬悧鍫㈠幈闁诲函缍嗛崑鍛焊娴煎瓨鐓欑€瑰嫮澧楅崳鐣岀磼椤旂晫鎳囬柟铏殜椤㈡盯鏁愰崨顔芥瘔缂傚倸鍊搁崐鎼佸磹閹间礁纾归柟闂寸绾惧湱鎲搁悧鍫濈瑲闁稿顑夐弻锝夊箛椤掑倷绮靛銈嗗姌婵倝濡甸崟顖氱疀闁割偅娲橀宥夋⒑閸濆嫭濯奸柛鎾跺枛楠炲啫顫滈埀顒勫箖濞嗘挸绾ч柟瀛樼箓琚樺┑锛勫亼閸婃垿宕曢弻銉ｂ偓鍐幢濞嗘劕搴婂┑鐐村灟閸ㄥ湱绮ｅΔ鍛闁规儼妫勭壕瑙勪繆閵堝懎鏆熷☉鎾崇Ч閺屾洘寰勯崱妯荤彆闂佺顑囨慨鐢垫崲濞戙垹绠ｉ柣鎰閸ㄧ敻鏁冮姀銈嗗亱闁割偅绮庣粻姘舵⒑缂佹ê濮堢憸鏉垮暣閸┾偓妞ゆ巻鍋撴繝鈧潏鈺佸灊婵娉涚涵鈧梺缁樺姀閺呮粓寮埀顒勬⒒娴ｈ櫣銆婇柛鎾寸箞閹兘鏁冮崒姘辩枀婵犻潧鍊搁幉锟犓夋繝鍐︿簻闁规壋鏅涢悘顏嗙磼娴ｅ弶娅婇柡灞剧〒閳ь剨缍嗘禍婵嬎夐姀鈶╁亾鐟欏嫭绌跨紒鏌ョ畺楠炲棝寮崼婢晠鏌?
app.get("/api/eval/cases", async (request) => {
  const query = (request.query ?? {}) as { suite?: string; enabled?: string };
  return { data: { cases: listEvalCases({ suite: query.suite, enabledOnly: query.enabled === "true" }) } };
});

app.post("/api/eval/cases", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  if (!body?.id || !body?.suite || !body?.name || typeof body.input !== "string" || typeof body.expected !== "string") {
    return reply.code(400).send({ data: { ok: false, error: "id is required" } });
  }
  return reply.code(201).send({ data: { case: upsertEvalCase(body as never) } });
});

app.patch("/api/eval/cases/:id", async (request, reply) => {
  const params = request.params as { id: string };
  const body = { ...(request.body as Record<string, unknown>), id: params.id };
  const current = listEvalCases().find((item) => item.id === params.id);
  if (!current) return reply.code(404).send({ data: { ok: false, error: "EvalCase not found" } });
  return { data: { case: upsertEvalCase({ ...current, ...body } as never) } };
});

app.delete("/api/eval/cases/:id", async (request, reply) => {
  const params = request.params as { id: string };
  if (!deleteEvalCase(params.id)) return reply.code(404).send({ data: { ok: false, error: "EvalCase not found" } });
  return { data: { ok: true } };
});

async function executeEvalBatch(batchId: string): Promise<void> {
  try {
    let batch = updateEvalBatch(batchId, (item) => ({ ...item, status: "running", startedAt: item.startedAt ?? new Date().toISOString(), error: undefined }));
    const suites = await runAllEvals();
    const byId = new Map(suites.flatMap((suite) => suite.cases.map((item) => [item.id, { suite: suite.id, item }] as const)));
    const resultIds: string[] = [];
    for (let index = 0; index < batch.caseSnapshot.length; index += 1) {
      const definition = batch.caseSnapshot[index];
      const found = byId.get(definition.id);
      const createdAt = new Date().toISOString();
      const result: EvalBatchResult = {
        id: `${batch.id}:${definition.id}`, batchId: batch.id, caseId: definition.id, suite: definition.suite,
        status: found ? (found.item.status ?? (found.item.pass ? "PASS" : "FAIL")) : "ERROR",
        pass: Boolean(found?.item.pass), scoringMethod: found?.item.scoringMethod ?? "exact_match",
        input: found?.item.input ?? definition.input, expected: found?.item.expected ?? definition.expected,
        actual: found?.item.actual ?? "No generated result", evidence: found?.item.actual ? [found.item.actual] : [],
        misses: found && !found.item.pass ? [found.item.detail] : [], detail: found?.item.detail ?? "Case has no result",
        durationMs: 0, createdAt,
      };
      appendEvalBatchResult(result);
      resultIds.push(result.id);
      const counts = summarizeStatuses(getEvalBatchResults(batch.id));
      batch = updateEvalBatch(batch.id, (item) => ({ ...item, currentIndex: index + 1, resultIds, ...counts }));
    }
    updateEvalBatch(batch.id, (item) => ({ ...item, status: "done", currentIndex: item.total, finishedAt: new Date().toISOString(), ...summarizeStatuses(getEvalBatchResults(batch.id)) }));
  } catch (error) {
    updateEvalBatch(batchId, (item) => ({ ...item, status: "error", finishedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
  }
}

app.get("/api/workspace/overview", async () => {
  const creators = moduleOverview("creators");
  const audit = moduleOverview("audit");
  const redfoxKey = (process.env.REDFOX_API_KEY ?? "").trim();
  const redfoxConfigured = Boolean(redfoxKey && !redfoxKey.startsWith("REPLACE_WITH_"));
  const modelConfigured = Boolean((process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY ?? "").trim());
  const probe = async (url: string) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return response.ok ? "running" : `HTTP ${response.status}`;
    } catch {
      return "unavailable";
    }
  };
  const [frontendStatus, apiStatus] = await Promise.all([
    probe("http://127.0.0.1:5173"),
    probe("http://127.0.0.1:3001/api/v1/health"),
  ]);
  return { data: {
    generatedAt: new Date().toISOString(),
    system: {
      frontend: { url: "http://127.0.0.1:5173", status: frontendStatus },
      api: { url: "http://127.0.0.1:3001", status: apiStatus, healthPath: "/api/v1/health" },
      worker: { status: "running" },
      eval: { url: "http://127.0.0.1:3081", status: "running", localOnly: true },
    },
    business: {
      creators: { cases: creators.cases.length, runs: creators.runs.length, batches: creators.batches.length },
      audit: { cases: audit.cases.length, runs: audit.runs.length, batches: audit.batches.length },
      userData: { source: "Supabase", privacy: "No secrets or tokens", note: "User details require sign-in to the main system." },
    },
    providers: { textModelConfigured: modelConfigured, redfox: { configured: redfoxConfigured, baseUrl: process.env.REDFOX_BASE_URL ?? "https://redfox.hk", usage: "Usage is recorded by local server telemetry; provider billing is shown in the RedFoxHub console." } },
    analytics: await getUsageOverview()  } };
});
app.get("/api/analytics/overview", async () => ({ data: { ...(await getUsageOverview()), feedback: await feedbackSummary() } }));

app.get("/api/admin/feedback", { preHandler: requireEvalAdmin }, async (_request, reply) => {
  try {
    const { configured, rows } = await readFeedbackRows();
    const summary = {
      total: rows.length,
      open: rows.filter((row) => row.status === "open").length,
      inProgress: rows.filter((row) => row.status === "in_progress").length,
      resolved: rows.filter((row) => row.status === "resolved" || row.status === "closed").length,
      bugs: rows.filter((row) => row.category === "bug").length,
    };
    return { data: { configured, tickets: rows, summary } };
  } catch (error) {
    app.log.error({ err: error }, "Feedback admin query failed");
    const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
    const message = code === "PGRST205" || code === "42P01"
      ? "反馈数据表尚未初始化，请先应用 supabase/migrations/202609040001_feedback_tickets.sql。"
      : "反馈数据暂时不可用，请确认 SUPABASE_SERVICE_ROLE_KEY 已配置。";
    return reply.code(503).send({ error: message });
  }
});

app.patch("/api/admin/feedback/:id", { preHandler: requireEvalAdmin }, async (request, reply) => {
  if (!feedbackAdminClient) return reply.code(503).send({ error: "反馈数据暂时不可用，请确认 SUPABASE_SERVICE_ROLE_KEY 已配置。" });
  const body = (request.body ?? {}) as { status?: unknown; priority?: unknown; admin_reply?: unknown };
  const status = typeof body.status === "string" ? body.status : undefined;
  const priority = typeof body.priority === "string" ? body.priority : undefined;
  const adminReply = body.admin_reply == null ? null : typeof body.admin_reply === "string" ? body.admin_reply.trim() : undefined;
  if ((status && !["open", "in_progress", "resolved", "closed"].includes(status)) || (priority && !["low", "normal", "high", "urgent"].includes(priority)) || adminReply === undefined || (adminReply && adminReply.length > 5000)) {
    return reply.code(400).send({ error: "工单状态、优先级或回复内容不合法。" });
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status) { patch.status = status; patch.resolved_at = status === "resolved" || status === "closed" ? new Date().toISOString() : null; }
  if (priority) patch.priority = priority;
  if (adminReply !== undefined) patch.admin_reply = adminReply || null;
  const id = (request.params as { id: string }).id;
  const { data, error } = await feedbackAdminClient.from("feedback_tickets").update(patch).eq("id", id).select("id,status,priority,admin_reply,updated_at,resolved_at").maybeSingle();
  if (error) return reply.code(500).send({ error: "工单更新失败。" });
  if (!data) return reply.code(404).send({ error: "工单不存在。" });
  return { data };
});
app.get("/api/analytics/logs", async (request) => {
  const query = (request.query ?? {}) as { limit?: string; provider?: string; status?: string; module?: string; endpoint?: string };
  const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50) || 50));
  let logs = await readApiLogs();
  if (query.provider) logs = logs.filter((item) => item.provider === query.provider);
  if (query.status && ["success", "error", "blocked"].includes(query.status)) logs = logs.filter((item) => item.status === query.status);
  if (query.module && ["creator", "audit", "system"].includes(query.module)) logs = logs.filter((item) => item.module === query.module);
  if (query.endpoint) logs = logs.filter((item) => item.endpoint.includes(query.endpoint!));
  logs = logs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { data: { logs: logs.slice(0, limit), total: logs.length, generatedAt: new Date().toISOString() } };
});
app.get("/api/analytics/logs/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const log = await getApiLog(id);
  if (!log) return reply.code(404).send({ data: { ok: false, error: "API log not found" } });
  return { data: { log } };
});
app.get("/api/eval/overview", async () => {
  const cases = seedEvalCases();
  const batches = listEvalBatches();
  const latest = batches[0];
  const summary = latest ? { passed: latest.passed, failed: latest.failed, review: latest.review, errors: latest.errors } : { passed: 0, failed: 0, review: 0, errors: 0 };
  return { data: { evaluatorVersion: EVALUATOR_VERSION, cases: { total: cases.length, enabled: cases.filter((item) => item.enabled).length }, latestBatch: latest ?? null, summary, qualityPassRate: qualityPassRate(summary) } };
});

// 婵?SnackOps 闂傚倸鍊峰ù鍥х暦閸偅鍙忛柡澶嬪殮濞差亜围闁搞儻绲芥禍鐐叏濡厧甯舵鐐搭焽缁辨帡顢欑涵宄板闂侀€炲苯澧紒瀣浮閳ワ箓宕堕鈧悡婵嬫煛閸愶絽浜鹃梺闈涙搐鐎氫即鐛Ο鍏煎磯閺夌偟澧楅崺娑樷攽閻樻鏆柍褜鍓濆▍鏇㈠箹閹扮増鍤曢柟鎵閻撴洟鏌曟径娑氬埌濠德ゆ硶缁辨帡鎮╁畷鍥р拰闂佽鍠楅〃濠傜暦瑜版帩鏁冮柨婵嗗椤ュ牓鏌ｆ惔銈庢綈婵炴彃绻樺畷鏇㈡惞椤愩値娴勯梺鎸庢礀閸婂綊宕靛澶嬬厪濠㈣泛鐗嗛崝妤呮煕鐎ｎ偅宕屾鐐查叄閹崇偤濡疯楠炴﹢姊洪崫鍕垫Ц闁绘瀚板畷婵婄疀閺冨倻褰惧┑顔姐仜閸嬫捇鏌″畝鈧崰鏍€佸▎鎰檮缂佸鐏濋崣濠囨煟鎼淬値娼愭繛鍙夛耿閵嗗啯绻濋崘褏绠氶梺缁樺灱濡嫬鏁梻渚€娼ч敍蹇涘川椤忓懐浜欓梻鍌氬€搁崐鐑芥倿閿旈敮鍋撶粭娑樻噽閻瑩鏌熸潏楣冩闁稿孩顨婇弻娑樼暆閳ь剟宕戝☉婊呯婵犵數濮伴崹濂稿春閺嶎厼绀夐柡宥庡帞婢舵劕閱囬柕澶涘閸橆亪妫呴銏″婵炲弶鐗曢悺顓㈡⒑閼姐倕小闁绘帪绠掗妵鎰板礃椤旇偐鍙€婵犮垼鍩栭崝鏇犵不缂佹ǜ浜滈柡宥冨妿閻擃垰顭跨憴鍕缂佺粯绻堥幃浠嬫濞戞鎹曟繝纰樻閸嬪嫰鎯岄崒鐐叉槬闁逞屽墯閵囧嫰骞掗崱妞惧闂備礁鎽滈崰搴☆焽閿熺姵鏅查柣鎰劋閺呮彃顭跨捄鐚村姛濡ょ姴娲铏圭磼濡搫顫岄梺璇茬箲閼归箖鍩㈠澶婂嵆闁靛骏绱曢崢鍛婄箾鏉堝墽绉繛浣冲洤鐒垫い鎺嶈兌婢ц京绱掗鍛籍闁诡喓鍨婚幃浼村灳閸忓懎顥氶梻浣瑰缁诲倿宕锝勭箚闁绘垼濮ら悡鏇㈡倵閿濆骸浜濋悘蹇庡嵆閺岀喎鐣￠悧鍫濇畻闂佽鍠氶崗姗€寮婚崶顒佹櫆缂佹稑顑嗛ˉ锝嗙節閻㈤潧啸闁轰焦鎮傚畷鎴濃槈濡粍绋戦悾婵嬪礋椤愩倕濮︽俊鐐€栫敮鎺楀疮椤栫偞鍋熸い蹇撶墛閸婂灚鎱ㄥΟ鍝勬毐闁汇劏娅ｇ槐鎺撴綇閵婏箑闉嶉梺鐟板槻閹虫劙骞夐幘顔肩妞ゆ劧濡囬埀顒佹そ濮婄粯鎷呯粵瀣缂備胶绮崝娆掓闂佸壊鐓堥崑鍌滄崲?
app.get("/api/eval", async () => {
  const cases = seedEvalCases();
  const batches = listEvalBatches();
  const latestResults = batches[0] ? getEvalBatchResults(batches[0].id) : [];
  return { cases, enabledCases: cases.filter((item) => item.enabled), batches, results: latestResults.slice(0, 30), evaluatorVersion: EVALUATOR_VERSION };
});

app.get("/api/eval/batches", async () => ({ data: { batches: listEvalBatches() } }));

app.post("/api/eval/batches", async (request, reply) => {
  try {
    const body = (request.body ?? {}) as { name?: string; versionLabel?: string; caseIds?: string[] };
    const batch = createEvalBatch(body);
    void executeEvalBatch(batch.id);
    return reply.code(202).send({ data: { batch } });
  } catch (error) {
    return reply.code(400).send({ data: { ok: false, error: error instanceof Error ? error.message : String(error) } });
  }
});

app.get("/api/eval/batches/:id", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const batch = getEvalBatch(id);
  if (!batch) return reply.code(404).send({ data: { ok: false, error: "Batch not found" } });
  return { data: { batch, results: getEvalBatchResults(id) } };
});

app.get("/api/eval/compare", async (request, reply) => {
  const query = (request.query ?? {}) as { left?: string; right?: string };
  if (!query.left || !query.right) return reply.code(400).send({ data: { ok: false, error: "left and right batch ids are required" } });
  const left = getEvalBatch(query.left);
  const right = getEvalBatch(query.right);
  if (!left || !right) return reply.code(404).send({ data: { ok: false, error: "Batch not found" } });
  const leftResults = new Map(getEvalBatchResults(left.id).map((item) => [item.caseId, item]));
  const rightResults = new Map(getEvalBatchResults(right.id).map((item) => [item.caseId, item]));
  const fixed: string[] = [];
  const regressions: string[] = [];
  const changed: string[] = [];
  for (const caseId of new Set([...leftResults.keys(), ...rightResults.keys()])) {
    const before = leftResults.get(caseId)?.status;
    const after = rightResults.get(caseId)?.status;
    if (before !== "PASS" && after === "PASS") fixed.push(caseId);
    if (before === "PASS" && after !== "PASS") regressions.push(caseId);
    if (before && after && before !== after) changed.push(caseId);
  }
  return { data: { comparable: left.caseSetHash === right.caseSetHash && left.evaluatorVersion === right.evaluatorVersion, left, right, fixed, regressions, changed } };
});

app.post("/api/eval/batches/:id/cancel", async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const batch = getEvalBatch(id);
  if (!batch) return reply.code(404).send({ data: { ok: false, error: "Batch not found" } });
  return { data: { batch: updateEvalBatch(id, (item) => item.status === "done" ? item : ({ ...item, status: "cancelled", finishedAt: new Date().toISOString() })) } };
});

app.get("/module.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(readFileSync(join(__dirname, "public", "module.css"), "utf8")));
const workspaceModuleStyle = `<style id="workspace-embed-style">
  html,body{min-height:100%;background:#f5f7fa!important}
  .module-stripe{display:none!important}
  .rail,.topbar{display:none!important}
  .app{display:block!important;min-height:0!important}
  .workspace{min-width:0!important}
  .content{max-width:none!important;padding:24px 28px 48px!important}
</style>`;
const workspaceAdminFocusStyle = `<style id="workspace-admin-focus-style">
  .content{display:block!important}
  .content>.notice{display:none!important}
  html body #view{display:block!important}
  html body #metrics,html body #adminTabs,html body #adminBasePanel,html body #adminLogsPanel{display:none!important}
</style>`;
const workspaceEvalStyle = `<style id="workspace-eval-style">
  .top{display:none!important}
  .notice{display:none!important}
  .wrap{max-width:none!important;padding:24px 28px 48px!important}
  .eval-shell{display:block!important;margin-top:20px!important}
  .eval-side{display:none!important}
</style>`;
const workspaceOpsStyle = `<style id="workspace-ops-style">
  .head,.module-tabs,.workspace-tabs,.metrics{display:none!important}
  .page{max-width:none!important;padding:24px 28px 48px!important}
  #notice:empty{display:none!important}
  #view{display:block!important}
</style>`;
function embeddedPage(fileName: string, extraStyle = ""): string {
  const html = readFileSync(join(__dirname, "public", fileName), "utf8");
  return html.replace("</head>", `${workspaceModuleStyle}${extraStyle}</head>`);
}

app.get("/workspace/:view", async (request, reply) => {
  const view = (request.params as { view: string }).view;
  const pages: Record<string, { file: string; style?: string }> = {
    admin: { file: "module-admin.html" },
    skills: { file: "module-admin.html", style: workspaceAdminFocusStyle },
    tools: { file: "module-admin.html", style: workspaceAdminFocusStyle },
    planner: { file: "module-planner.html" },
    models: { file: "module-model.html" },
    ops: { file: "module-operations.html" },
    eval: { file: "unified-eval.html", style: workspaceEvalStyle },
  };
  const page = pages[view];
  if (!page) return reply.code(404).send("workspace view not found");
  return reply.type("text/html; charset=utf-8").send(embeddedPage(page.file, page.style));
});

app.get("/agent/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send({ error: "module not found" });
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-agent.html"), "utf8"));
});
app.get("/planner/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send({ error: "module not found" });
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-planner.html"), "utf8"));
});
app.get("/admin", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "workspace.html"), "utf8"));
});
app.get("/admin/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send("module not found");
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-admin.html"), "utf8"));
});

app.get("/models/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send("module not found");
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-model.html"), "utf8"));
});
app.get("/catalog/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send("module not found");
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-catalog.html"), "utf8"));
});
app.get("/ops/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send("module not found");
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "module-ops.html"), "utf8"));
});
app.get("/eval", async (_request, reply) => {
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "workspace.html"), "utf8"));
});
app.get("/eval/:module", async (request, reply) => {
  const module = (request.params as { module: string }).module;
  if (module !== "creators" && module !== "audit") return reply.code(404).send("module not found");
  return reply.type("text/html; charset=utf-8").send(readFileSync(join(__dirname, "public", "unified-eval.html"), "utf8"));
});

app.get("/", async (_request, reply) => reply.redirect("/admin"));

await app.listen({ port: PORT, host: "127.0.0.1" });




