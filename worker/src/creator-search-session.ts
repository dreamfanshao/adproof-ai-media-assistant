import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import type { RedfoxNoteCandidate, RedfoxSearchCursor } from "./redfox-xhs-client.js";

type JsonRecord = Record<string, unknown>;
// The provider endpoint and normalization strategy are encoded into the key.
// Bump this value whenever either changes so stale cursors cannot short-circuit
// a new discovery strategy before it sends an upstream request.
export const CREATOR_SEARCH_STRATEGY_VERSION = "redfox-realtime-v4-pending-save";

export interface CreatorSearchSession {
  id: string;
  cursor: RedfoxSearchCursor;
  sourceExhausted: boolean;
  pending?: PendingSearchBatch | null;
}

/**
 * A recalled batch that has not been fully analyzed yet. It lives inside the
 * existing cursor_state JSON so a worker restart cannot skip candidates that
 * were returned by RedFox but fell outside the per-wave analysis tranche.
 */
export interface PendingSearchBatch {
  notes: RedfoxNoteCandidate[];
  cursor: RedfoxSearchCursor;
  sourceExhausted: boolean;
}

/** 新增关键词后，即使旧会话已耗尽，也必须继续检索尚未遍历的关键词。 */
export function isSearchSourceExhausted(
  storedSourceExhausted: boolean,
  cursor: RedfoxSearchCursor,
  currentKeywords: string[],
): boolean {
  if (!storedSourceExhausted || currentKeywords.length === 0) return false;
  const exhausted = new Set(cursor.exhaustedKeywords);
  return currentKeywords.every((keyword) => exhausted.has(keyword));
}

export interface SearchScreeningInput {
  creatorPlatformId: string;
  noteKey: string;
  noteId?: string | null;
  disposition: "accepted" | "project_existing" | "filtered" | "failed";
  reasonCode: string;
  nextEligibleAt?: string | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonRecord).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
}

export function creatorSearchKey(projectId: string, query: string, rule: unknown): string {
  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(`${projectId}\0${normalizedQuery}\0${JSON.stringify(stableValue(rule))}\0${CREATOR_SEARCH_STRATEGY_VERSION}`).digest("hex");
}

function normalizeCursor(value: unknown): RedfoxSearchCursor {
  const record = value && typeof value === "object" ? value as JsonRecord : {};
  const pages = record.nextPageByKeyword && typeof record.nextPageByKeyword === "object" ? record.nextPageByKeyword as Record<string, unknown> : {};
  return {
    nextPageByKeyword: Object.fromEntries(Object.entries(pages).map(([key, page]) => [key, Math.max(1, Number(page) || 1)])),
    exhaustedKeywords: Array.isArray(record.exhaustedKeywords) ? record.exhaustedKeywords.filter((item): item is string => typeof item === "string") : [],
    nextKeywordIndex: Math.max(0, Number(record.nextKeywordIndex ?? 0) || 0),
  };
}

function normalizePending(value: unknown): PendingSearchBatch | null {
  if (!value || typeof value !== "object") return null;
  const record = value as JsonRecord;
  const notes = Array.isArray(record.notes) ? record.notes.filter((item): item is RedfoxNoteCandidate => {
    if (!item || typeof item !== "object") return false;
    const row = item as JsonRecord;
    return typeof row.userId === "string" && typeof row.title === "string" && typeof row.text === "string";
  }) : [];
  if (!notes.length) return null;
  return {
    notes,
    cursor: normalizeCursor(record.cursor),
    sourceExhausted: Boolean(record.sourceExhausted),
  };
}

export async function loadOrCreateSearchSession(client: SupabaseClient, input: {
  userId: string;
  projectId: string;
  query: string;
  rule: unknown;
  keywords: string[];
}): Promise<CreatorSearchSession> {
  const searchKey = creatorSearchKey(input.projectId, input.query, input.rule);
  const { data: existing, error: queryError } = await client.from("creator_search_sessions").select("id,cursor_state,source_exhausted,cycle_started_at").eq("user_id", input.userId).eq("project_id", input.projectId).eq("search_key", searchKey).maybeSingle();
  if (queryError) throw new Error(`query creator search session: ${queryError.message}`);
  if (existing) {
    const cycleAge = Date.now() - Date.parse(String(existing.cycle_started_at));
    if (cycleAge < 30 * 86_400_000) {
      const cursorState = existing.cursor_state && typeof existing.cursor_state === "object" ? existing.cursor_state as JsonRecord : {};
      const cursor = normalizeCursor(cursorState);
      return {
        id: String(existing.id),
        cursor,
        sourceExhausted: isSearchSourceExhausted(Boolean(existing.source_exhausted), cursor, input.keywords),
        pending: normalizePending(cursorState.pending),
      };
    }
    const resetCursor: RedfoxSearchCursor = { nextPageByKeyword: {}, exhaustedKeywords: [], nextKeywordIndex: 0 };
    const { error } = await client.from("creator_search_sessions").update({ cursor_state: resetCursor, source_exhausted: false, keywords: input.keywords, query_text: input.query, confirmed_rule: input.rule, legacy_seeded_at: null, cycle_started_at: new Date().toISOString() }).eq("id", existing.id);
    if (error) throw new Error(`reset creator search session: ${error.message}`);
    return { id: String(existing.id), cursor: resetCursor, sourceExhausted: false, pending: null };
  }
  const cursor: RedfoxSearchCursor = { nextPageByKeyword: {}, exhaustedKeywords: [], nextKeywordIndex: 0 };
  const { data, error } = await client.from("creator_search_sessions").insert({ user_id: input.userId, project_id: input.projectId, search_key: searchKey, query_text: input.query, confirmed_rule: input.rule, keywords: input.keywords, cursor_state: cursor }).select("id").single();
  if (error || !data) throw new Error(`create creator search session: ${error?.message ?? "no row"}`);
  return { id: String(data.id), cursor, sourceExhausted: false, pending: null };
}

export function projectSearchHistoryFromRows(rows: Array<{ note_key?: unknown; creator_platform_id?: unknown }>): { noteKeys: Set<string>; creatorIds: Set<string> } {
  const noteKeys = new Set<string>();
  const creatorIds = new Set<string>();
  for (const row of rows) {
    const noteKey = String(row.note_key ?? "").trim();
    const creatorId = String(row.creator_platform_id ?? "").trim();
    if (noteKey) noteKeys.add(noteKey);
    if (creatorId) creatorIds.add(creatorId);
  }
  return { noteKeys, creatorIds };
}

export async function loadProjectSearchHistory(client: SupabaseClient, projectId: string): Promise<{ noteKeys: Set<string>; creatorIds: Set<string> }> {
  const { data, error } = await client.from("creator_search_screenings").select("note_key,creator_platform_id").eq("project_id", projectId).limit(10_000);
  if (error) throw new Error(`query creator search history: ${error.message}`);
  return projectSearchHistoryFromRows(data ?? []);
}

export async function saveSearchSessionProgress(client: SupabaseClient, sessionId: string, cursor: RedfoxSearchCursor, sourceExhausted: boolean, keywords: string[], pending: PendingSearchBatch | null = null): Promise<void> {
  const cursorState = pending ? { ...cursor, pending } : cursor;
  const { error } = await client.from("creator_search_sessions").update({ cursor_state: cursorState, source_exhausted: sourceExhausted, keywords }).eq("id", sessionId);
  if (error) throw new Error(`update creator search session: ${error.message}`);
}

export async function recordSearchScreenings(client: SupabaseClient, input: { sessionId: string; taskId: string; userId: string; projectId: string; rows: SearchScreeningInput[] }): Promise<void> {
  if (!input.rows.length) return;
  const payload = input.rows.map((row) => ({ session_id: input.sessionId, search_task_id: input.taskId, user_id: input.userId, project_id: input.projectId, creator_platform_id: row.creatorPlatformId, note_key: row.noteKey, note_id: row.noteId ?? null, disposition: row.disposition, reason_code: row.reasonCode, next_eligible_at: row.nextEligibleAt ?? null }));
  const { error } = await client.from("creator_search_screenings").upsert(payload, { onConflict: "session_id,note_key" });
  if (error) throw new Error(`record creator search screenings: ${error.message}`);
}

export async function seedLegacySearchHistory(pool: pg.Pool, client: SupabaseClient, input: { sessionId: string; taskId: string; userId: string; projectId: string }): Promise<void> {
  const { data: session, error: sessionError } = await client.from("creator_search_sessions").select("legacy_seeded_at").eq("id", input.sessionId).single();
  if (sessionError) throw new Error(`query legacy seed state: ${sessionError.message}`);
  if (session?.legacy_seeded_at) return;
  const result = await pool.query(`select j.result, j.completed_at from private.jobs j join public.search_tasks s on s.task_id = j.id where s.user_id = $1 and s.project_id = $2 and s.id <> $3 and j.completed_at >= now() - interval '30 days' order by j.completed_at desc limit 100`, [input.userId, input.projectId, input.taskId]);
  const rows: SearchScreeningInput[] = [];
  const seen = new Set<string>();
  for (const item of result.rows) {
    const rejections = Array.isArray(item.result?.rejections) ? item.result.rejections as JsonRecord[] : [];
    for (const rejection of rejections) {
      const creatorId = typeof rejection.creatorId === "string" ? rejection.creatorId : "";
      if (!creatorId || seen.has(creatorId)) continue;
      seen.add(creatorId);
      const reason = typeof rejection.reason === "string" ? rejection.reason : "LEGACY_FILTERED";
      const failed = /FAILED|ERROR/.test(reason);
      rows.push({ creatorPlatformId: creatorId, noteKey: `legacy:${creatorId}`, disposition: failed ? "failed" : reason === "ALREADY_IN_PROJECT" ? "project_existing" : "filtered", reasonCode: reason, nextEligibleAt: new Date(Date.now() + (failed ? 1 : 30) * 86_400_000).toISOString() });
    }
  }
  await recordSearchScreenings(client, { sessionId: input.sessionId, taskId: input.taskId, userId: input.userId, projectId: input.projectId, rows });
  const { error } = await client.from("creator_search_sessions").update({ legacy_seeded_at: new Date().toISOString() }).eq("id", input.sessionId);
  if (error) throw new Error(`mark legacy search history seeded: ${error.message}`);
}
