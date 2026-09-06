import type { CreatorProfileFields, SearchCreatorRef } from "./xhs-field-mapper.js";
import { FIELD_WARNING, XHS_ORIGIN } from "./xhs-constants.js";
import { recordUsageEvent } from "../../server/src/services/usage-analytics.js";

type JsonRecord = Record<string, unknown>;

export interface RnoteCreatorProfile {
  ref: SearchCreatorRef;
  fields: CreatorProfileFields;
}

export interface RnoteNoteCandidate {
  noteId: string | null;
  userId: string;
  nickname: string | null;
  handle: string | null;
  profileUrl: string;
  title: string;
  text: string;
  imageUrls: string[];
  interaction: number | null;
  noteType: "image" | "video" | "unknown";
  raw: JsonRecord;
}

export interface RnoteNoteCollectResult {
  notes: RnoteNoteCandidate[];
  pages: number;
  requestCount: number;
  retryCount: number;
}

export interface RnoteClientOptions {
  apiKey: string;
  provider?: "rnote" | "redfox" | "dataflow";
  baseUrl?: string;
  searchPath?: string;
  imageNoteDetailPath?: string;
  videoNoteDetailPath?: string;
  userInfoPath?: string;
  userPostedNotesPath?: string;
  authorPerformancePath?: string;
  requestDelayMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  maxPages?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function firstRecord(...values: unknown[]): JsonRecord {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
    if (typeof value !== "string") continue;
    const match = value.trim().replace(/,/g, "").match(/([\d.]+)\s*(\u4ebf|\u4e07|k|w)?/i);
    if (!match) continue;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) continue;
    const unit = match[2]?.toLowerCase();
    const multiplier = unit === "\u4ebf" ? 100_000_000 : unit === "\u4e07" || unit === "w" ? 10_000 : unit === "k" ? 1_000 : 1;
    return Math.round(base * multiplier);
  }
  return null;
}

function arrayFrom(...values: unknown[]): unknown[] {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
}

function imageUrl(value: unknown): string | null {
  const record = asRecord(value);
  return firstString(typeof value === "string" ? value : null, record?.url, record?.url_default, record?.urlPre, record?.url_pre, record?.origin_url, record?.image_url, record?.coverImage, record?.defaultUrl, record?.hdUrl, record?.previewUrl, record?.cover_image, record?.imageUrl);
}

function imageUrls(...values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    for (const item of arrayFrom(value)) {
      const url = imageUrl(item);
      if (url && /^https?:\/\//i.test(url)) result.push(url);
    }
    const direct = imageUrl(value);
    if (direct && /^https?:\/\//i.test(direct)) result.push(direct);
  }
  return Array.from(new Set(result)).slice(0, 24);
}

function interactionCount(note: JsonRecord): number | null {
  const values = [
    firstNumber(note.liked_count, note.like_count, note.likes, note.liked, note.thumbCount, note.thumb_count),
    firstNumber(note.collected_count, note.collect_count, note.collects, note.collected, note.favoriteCount, note.favorite_count),
    firstNumber(note.shared_count, note.share_count, note.shares, note.shared, note.forwardCount, note.forward_count),
    firstNumber(note.comments_count, note.comment_count, note.comments, note.replyCount, note.reply_count),
  ].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function candidateItems(payload: JsonRecord): JsonRecord[] {
  const roots: unknown[] = [payload.data, asRecord(payload.data)?.data, payload.result, asRecord(payload.result)?.data, payload.items, payload.notes, payload.workList, payload.records];
  for (const root of roots) {
    const record = asRecord(root);
    const items = arrayFrom(record?.items, record?.notes, record?.list, record?.hits, record?.workList, record?.records, root);
    if (items.length) return items.map((item) => asRecord(item)).filter((item): item is JsonRecord => Boolean(item));
  }
  return [];
}

function normalizeNote(item: JsonRecord): RnoteNoteCandidate | null {
  const note = firstRecord(item.note, item.note_info, item.post, item);
  const user = firstRecord(item.user, note.user, item.author, note.author, item.author_info, note.author_info);
  const userId = firstString(user.id, user.user_id, user.userId, user.authorUid, user.author_uid, note.user_id, note.userId, note.authorUid, item.user_id, item.userId, item.authorUid);
  if (!userId) return null;
  const noteId = firstString(note.note_id, note.noteId, note.id, item.note_id, item.noteId, item.id);
  const nickname = firstString(user.nickname, user.nick_name, user.nickName, user.name, user.authorName, note.user_nickname, note.authorName, item.nickname, item.authorName);
  const handle = firstString(user.red_id, user.redId, user.xhs_id, user.user_name, user.username, user.authorUid);
  const profileUrl = firstString(user.profile_url, user.profileUrl, user.home_url, user.homeUrl, user.url) ?? `${XHS_ORIGIN}/user/profile/${userId}`;
  const title = firstString(note.title, note.noteTitle, note.name, item.title, item.noteTitle) ?? "";
  const text = firstString(note.desc, note.noteDesc, note.contentDesc, note.description, note.content, note.share_text, item.desc, item.noteDesc, item.contentDesc, item.description, item.content) ?? title;
  const images = imageUrls(note.image_list, note.imageList, note.images, note.image_urls, note.imageUrls, note.cover, note.cover_url, note.coverImage, note.imagesList, note.picList, note.picUrls, note.previewUrls, item.image_list, item.images, item.coverImage, item.picUrls, item.previewUrls);
  const typeValue = firstString(note.note_type, note.noteType, note.type, item.note_type, item.noteType, item.type)?.toLowerCase() ?? "";
  const noteType: RnoteNoteCandidate["noteType"] = typeValue.includes("video") || typeValue.includes("\u89c6\u9891") ? "video" : images.length ? "image" : "unknown";
  return { noteId, userId, nickname, handle, profileUrl, title: title.slice(0, 200), text: text.slice(0, 4000), imageUrls: images, interaction: interactionCount(note), noteType, raw: item };
}

function normalizeProfile(item: JsonRecord, fallback?: RnoteNoteCandidate): RnoteCreatorProfile | null {
  const note = firstRecord(item.note, item.note_info, item.post, item);
  const user = firstRecord(item.user, note.user, item.author, note.author, item.author_info, note.author_info, item.profile, item.data);
  const id = firstString(user.id, user.user_id, user.userId, user.authorUid, user.author_uid, note.user_id, note.userId, note.authorUid, item.user_id, item.userId, item.authorUid, item.uid, fallback?.userId);
  if (!id) return null;
  const nickname = firstString(user.nickname, user.nick_name, user.nickName, user.name, user.authorName, item.nickname, item.authorName, fallback?.nickname);
  const handle = firstString(user.red_id, user.redId, user.xhs_id, user.user_name, user.username, user.authorUid, item.redId, item.red_id, fallback?.handle);
  const profileUrl = firstString(user.profile_url, user.profileUrl, user.home_url, user.homeUrl, user.url, item.url, fallback?.profileUrl) ?? `${XHS_ORIGIN}/user/profile/${id}`;
  const followers = firstNumber(user.followers, user.fans, user.fans_count, user.follower_count, user.fansCount, user.fansNum, user.fans_num, user.fansCount, item.followers, item.fans, item.fans_count, item.fansNum, item.fansCount);
  const following = firstNumber(user.following, user.following_count, user.followCount, user.followingCount, item.followingCount);
  const likesCollected = firstNumber(user.likes_collected, user.liked_count, user.likes, user.liked, user.likeCollectCount, user.likeCount, item.likeCollectCount, item.likeCount);
  const bio = firstString(user.desc, user.description, user.bio, user.intro, user.introduction, item.introduction, item.bio);
  const title = fallback?.title || firstString(note.title, note.name, note.desc, note.description) || "Untitled note";
  const posts = [{ title: title.slice(0, 100), interaction: fallback?.interaction ?? interactionCount(note), imageUrls: fallback?.imageUrls ?? imageUrls(note.image_list, note.imageList, note.images, note.image_urls, note.imageUrls, note.cover, note.cover_url) }];
  const avatarUrl = imageUrl(user.avatar, user.avatar_url, user.avatarUrl, user.avatarUrl, user.image, user.avatarPic, item.avatar, item.avatarUrl);
  const warnings = [] as CreatorProfileFields["warnings"];
  if (!nickname) warnings.push(FIELD_WARNING.NICKNAME_MISSING);
  if (followers === null) warnings.push(FIELD_WARNING.FOLLOWERS_MISSING);
  if (!handle) warnings.push(FIELD_WARNING.HANDLE_MISSING);
  if (!bio) warnings.push(FIELD_WARNING.BIO_MISSING);
  if (!avatarUrl) warnings.push(FIELD_WARNING.AVATAR_MISSING);
  const fields: CreatorProfileFields = { nickname, handle, ipLocation: firstString(user.ip_location, user.ipLocation, item.ipRegion, item.area), bio, followers, following, likesCollected, avatarUrl, posts, imageUrls: posts.flatMap((post) => post.imageUrls), capturedAt: new Date().toISOString(), warnings, dataCompleteness: warnings.length === 0 ? "complete" : "partial" };
  return { ref: { platformCreatorId: id, profileUrl, cardNickname: nickname }, fields };
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

export class RnoteXhsClient {
  private readonly provider: "rnote" | "redfox" | "dataflow";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly searchPath: string;
  private readonly imageNoteDetailPath: string;
  private readonly videoNoteDetailPath: string;
  private readonly userInfoPath: string;
  private readonly userPostedNotesPath: string;
  private readonly authorPerformancePath: string;
  private readonly requestDelayMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private requestCount = 0;
  private retryCount = 0;
  private lastRequestAt = 0;

  constructor(options: RnoteClientOptions) {
    this.provider = options.provider ?? (process.env.XHS_DATA_PROVIDER === "dataflow" ? "dataflow" : process.env.XHS_DATA_PROVIDER === "redfox" ? "redfox" : "rnote");
    const envPrefix = this.provider === "dataflow" ? "DATAFLOW" : this.provider === "redfox" ? "REDFOX" : "RNOTE";
    const env = (name: string, fallback?: string) => process.env[`${envPrefix}_${name}`] ?? fallback;
    const apiKey = options.apiKey || env("API_KEY") || "";
    if (!apiKey.trim()) throw new Error(`${envPrefix}_API_KEY not configured`);
    this.apiKey = apiKey.trim();
    this.baseUrl = (options.baseUrl ?? env("BASE_URL", this.provider === "dataflow" ? "https://dataflow.apifox.cn" : this.provider === "redfox" ? "https://redfox.hk" : "https://rnote.dev/api/v2/crawler"))!.replace(/\/$/, "");
    this.searchPath = options.searchPath ?? env("SEARCH_PATH", this.provider === "dataflow" ? "/api/xhs/v3/appsearch" : this.provider === "redfox" ? "/story/api/xhs/ability/searchWork" : "/search/notes")!;
    this.imageNoteDetailPath = options.imageNoteDetailPath ?? env("NOTE_DETAIL_PATH", this.provider === "dataflow" ? "/api/xhs/v3/notedetail" : this.provider === "redfox" ? "/story/api/xhs/ability/notePerformance" : "/note/image")!;
    this.videoNoteDetailPath = options.videoNoteDetailPath ?? env("VIDEO_NOTE_DETAIL_PATH", this.provider === "dataflow" ? "/api/xhs/v3/videonotedetail" : this.provider === "redfox" ? "/story/api/xhs/ability/notePerformance" : "/note/video")!;
    this.userInfoPath = options.userInfoPath ?? env("USER_INFO_PATH", this.provider === "dataflow" ? "/api/xhs/v3/appuserinfo" : this.provider === "redfox" ? "/story/api/xhs/ability/userInfo" : "/user/info")!;
    this.userPostedNotesPath = options.userPostedNotesPath ?? env("USER_WORK_LIST_PATH", this.provider === "dataflow" ? "/api/xhs/v3/appuserposted" : this.provider === "redfox" ? "/story/api/xhs/ability/userWorkList" : "/user/posted")!;
    this.authorPerformancePath = env("AUTHOR_PERFORMANCE_PATH", this.provider === "redfox" ? "/story/api/xhs/ability/authorPerformance" : "")!;
    this.requestDelayMs = Math.max(300, options.requestDelayMs ?? Number(env("REQUEST_DELAY_MS", "1200")));
    this.maxRetries = Math.min(6, Math.max(0, options.maxRetries ?? Number(env("MAX_RETRIES", "3"))));
    this.backoffBaseMs = Math.max(250, options.backoffBaseMs ?? Number(env("BACKOFF_BASE_MS", "1000")));
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? Number(env("TIMEOUT_MS", "30000")));
    this.maxPages = Math.min(10, Math.max(1, options.maxPages ?? Number(env("SEARCH_PAGES", "2"))));
  }

  getMetrics(): { requestCount: number; retryCount: number } { return { requestCount: this.requestCount, retryCount: this.retryCount }; }

  private async requestJson(path: string, params: Record<string, string | number>): Promise<JsonRecord> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const wait = this.requestDelayMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      const normalizedPath = path.replace(/^\/+/, "");
      const url = new URL(normalizedPath, `${this.baseUrl}/`);
      if (this.provider !== "redfox") for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requestCount += 1;
      try {
        const headers = this.provider === "redfox" ? { "REDFOX_API_KEY": this.apiKey, "Content-Type": "application/json", Accept: "application/json" } : this.provider === "dataflow" ? { Authorization: `Token ${this.apiKey}`, Accept: "application/json" } : { "X-API-Key": this.apiKey, Accept: "application/json" };
        const response = await fetch(url, { method: this.provider === "redfox" ? "POST" : "GET", headers, body: this.provider === "redfox" ? JSON.stringify(params) : undefined, signal: controller.signal });
        const payload = await response.json().catch(() => ({})) as unknown;
        const body = Array.isArray(payload) ? { data: payload } : (asRecord(payload) ?? {});
        const businessCode = typeof body.code === "number" ? body.code : null;
        if (!response.ok || body.success === false || (businessCode !== null && businessCode !== 2000)) {
          const error = new Error(firstString(body.error, body.error_msg, body.message, body.msg, body.detail, body.title) ?? `${this.provider} request failed (HTTP ${response.status}, code ${businessCode ?? "unknown"})`);
          const retryable = RETRYABLE_STATUS.has(response.status);
          throw Object.assign(error, { status: response.status, retryable, retryAfter: Number(response.headers.get("retry-after") ?? body.retry_after ?? 0) });
        }
        void recordUsageEvent({ event: "rnote_call", provider: this.provider, status: "success", durationMs: Date.now() - started, metadata: { path: normalizedPath, attempt } });
        return body;
      } catch (error) {
        void recordUsageEvent({ event: "rnote_call", provider: this.provider, status: "error", durationMs: Date.now() - started, metadata: { path: normalizedPath, attempt } });
        lastError = error;
        const status = Number((error as { status?: number }).status ?? 0);
        const retryable = Boolean((error as { retryable?: boolean }).retryable) || !status;
        if (!retryable || attempt >= this.maxRetries) break;
        this.retryCount += 1;
        const retryAfter = Number((error as { retryAfter?: number }).retryAfter ?? 0);
        const backoff = retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : Math.min(60_000, this.backoffBaseMs * (2 ** attempt));
        await sleep(backoff + Math.floor(Math.random() * Math.min(500, this.backoffBaseMs)));
      } finally { clearTimeout(timer); }
    }
    throw lastError instanceof Error ? lastError : new Error(`${this.provider} request failed`);
  }

  async searchNotes(keyword: string, page = 1): Promise<JsonRecord> {
    const configuredType = this.provider === "dataflow"
      ? (process.env.DATAFLOW_SEARCH_NOTE_TYPE ?? "all")
      : this.provider === "redfox"
        ? (process.env.REDFOX_SEARCH_NOTE_TYPE ?? "不限")
        : (process.env.RNOTE_SEARCH_NOTE_TYPE ?? "0");
    const params: Record<string, string | number> = this.provider === "dataflow"
      ? { keyword, page, sort_type: "general", note_type: configuredType, note_time: process.env.DATAFLOW_SEARCH_NOTE_TIME ?? "all" }
      : this.provider === "redfox"
        ? { keyword, page, sort: process.env.REDFOX_SEARCH_SORT ?? "综合", note_type: configuredType, noteTime: process.env.REDFOX_SEARCH_NOTE_TIME ?? "不限" }
        : { keyword, page, sort_type: "general", note_type: /^\d+$/.test(configuredType) ? Number(configuredType) : configuredType };
    return this.requestJson(this.searchPath, params);
  }

  async enrichNote(note: RnoteNoteCandidate): Promise<RnoteNoteCandidate> {
    if (!note.noteId) return note;
    let payload: JsonRecord | null = null;
    try { payload = note.noteType === "video" ? await this.getVideoNoteDetail(note.noteId) : await this.getImageNoteDetail(note.noteId); } catch {
      if (note.noteType !== "video") { try { payload = await this.getVideoNoteDetail(note.noteId); } catch { return note; } } else return note;
    }
    const detail = firstRecord(Array.isArray(payload?.data) ? payload.data[0] : payload?.data, payload?.result, payload?.note, payload);
    const normalized = normalizeNote({ ...detail, user: firstRecord(detail.user, note.raw.user) });
    if (!normalized) return note;
    return { ...note, title: normalized.title || note.title, text: normalized.text || note.text, imageUrls: note.noteType === "video" ? [] : (normalized.imageUrls.length ? normalized.imageUrls : note.imageUrls), interaction: normalized.interaction ?? note.interaction, raw: { ...note.raw, detail } };
  }

  async getImageNoteDetail(noteId: string): Promise<JsonRecord> { return this.requestJson(this.imageNoteDetailPath, this.provider === "dataflow" ? { noteId } : this.provider === "redfox" ? { note_id: noteId, noteId } : { note_id: noteId }); }
  async getVideoNoteDetail(noteId: string): Promise<JsonRecord> { return this.requestJson(this.videoNoteDetailPath, this.provider === "dataflow" ? { noteId } : this.provider === "redfox" ? { note_id: noteId, noteId } : { note_id: noteId }); }
  async getUserInfo(userId: string): Promise<JsonRecord> { return this.requestJson(this.userInfoPath, this.provider === "dataflow" ? { userId } : this.provider === "redfox" ? { user_id: userId, userId } : { user_id: userId }); }
  async getUserPostedNotes(userId: string): Promise<JsonRecord> { return this.requestJson(this.userPostedNotesPath, this.provider === "dataflow" ? { userId, cursor: "" } : this.provider === "redfox" ? { userId, offset: "" } : { user_id: userId, num: 20 }); }

  async getAuthorPerformance(userId: string): Promise<JsonRecord> {
    if (this.provider !== "redfox" || !this.authorPerformancePath) return {};
    return this.requestJson(this.authorPerformancePath, { user_id: userId, userId });
  }

  async searchNoteCandidates(keyword: string, targetCount: number): Promise<RnoteNoteCollectResult> {
    const notes: RnoteNoteCandidate[] = [];
    const seen = new Set<string>();
    const pageLimit = Math.min(this.maxPages, Math.max(1, Math.ceil(Math.max(targetCount * 2, 20) / 20)));
    for (let page = 1; page <= pageLimit && notes.length < Math.max(targetCount * 2, 20); page += 1) {
      const payload = await this.searchNotes(keyword, page);
      for (const item of candidateItems(payload)) {
        const note = normalizeNote(item);
        if (!note) continue;
        const key = note.noteId ?? `${note.userId}:${note.title}:${note.text.slice(0, 80)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        notes.push(note);
        if (notes.length >= Math.max(targetCount * 2, 20)) break;
      }
    }
    return { notes, pages: pageLimit, ...this.getMetrics() };
  }

  async hydrateCreatorProfile(note: RnoteNoteCandidate, options: { includePostedNotes?: boolean } = {}): Promise<RnoteCreatorProfile | null> {
    const info = await this.getUserInfo(note.userId);
    const profile = normalizeProfile({ ...note.raw, ...info, user: firstRecord(info.data, info.user, info.profile, asRecord(info.data)?.user) }, note);
    if (!profile) return null;
    if (options.includePostedNotes !== false) try {
      const posted = await this.getUserPostedNotes(note.userId);
      for (const item of candidateItems(posted)) {
        const extra = normalizeProfile(item, note);
        if (!extra) continue;
        profile.fields.posts.push(...extra.fields.posts);
        profile.fields.imageUrls = Array.from(new Set([...profile.fields.imageUrls, ...extra.fields.imageUrls])).slice(0, 24);
      }
    } catch {
      // Profile data is still useful when the optional posted-notes endpoint is unavailable.
    }
    return profile;
  }
}

export function createRnoteXhsClient(env: Record<string, string | undefined>): RnoteXhsClient {
  const provider = env.XHS_DATA_PROVIDER === "dataflow" ? "dataflow" : env.XHS_DATA_PROVIDER === "redfox" ? "redfox" : "rnote";
  const prefix = provider === "dataflow" ? "DATAFLOW" : provider === "redfox" ? "REDFOX" : "RNOTE";
  const get = (key: string) => env[`${prefix}_${key}`];
  return new RnoteXhsClient({
    provider,
    apiKey: get("API_KEY") ?? "",
    baseUrl: get("BASE_URL"),
    searchPath: get("SEARCH_PATH"),
    imageNoteDetailPath: get("NOTE_DETAIL_PATH"),
    videoNoteDetailPath: get("VIDEO_NOTE_DETAIL_PATH") ?? get("NOTE_DETAIL_PATH"),
    userInfoPath: get("USER_INFO_PATH"),
    userPostedNotesPath: get("USER_POSTED_NOTES_PATH") ?? get("USER_WORK_LIST_PATH"),
  });
}




