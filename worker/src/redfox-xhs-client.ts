import type { CreatorProfileFields, SearchCreatorRef } from "./xhs-field-mapper.js";
import { FIELD_WARNING, XHS_ORIGIN } from "./xhs-constants.js";
import { recordApiLog, recordUsageEvent } from "../../server/src/services/usage-analytics.js";

type JsonRecord = Record<string, unknown>;

export interface RedfoxCreatorProfile {
  ref: SearchCreatorRef;
  fields: CreatorProfileFields;
}

export interface RedfoxCreatorHydration {
  profile: RedfoxCreatorProfile | null;
  noteDetailError: string | null;
  accountDetailError: string | null;
  postedNotesError: string | null;
}

export interface RedfoxNoteCandidate {
  noteId: string | null;
  userId: string;
  nickname: string | null;
  handle: string | null;
  profileUrl: string;
  title: string;
  text: string;
  imageUrls: string[];
  likes: number | null;
  interaction: number | null;
  publishedAt?: string;
  noteType: "image" | "video" | "unknown";
  raw: JsonRecord;
}

export interface RedfoxNoteCollectResult {
  notes: RedfoxNoteCandidate[];
  pages: number;
  keywords: string[];
  keywordFailures: Array<{ keyword: string; page: number; error: string }>;
  requestCount: number;
  retryCount: number;
  cacheHitCount: number;
  requestCountByEndpoint: Record<string, number>;
}

export interface RedfoxSearchCursor {
  nextPageByKeyword: Record<string, number>;
  exhaustedKeywords: string[];
  nextKeywordIndex: number;
}

export interface RedfoxNoteBatchResult extends RedfoxNoteCollectResult {
  cursor: RedfoxSearchCursor;
  sourceExhausted: boolean;
}

export interface RedfoxClientOptions {
  apiKey: string;
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
  maxRequestsPerSearch?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const REALTIME_SEARCH_PATH = "/story/api/xhs/ability/searchWork";
const REALTIME_USER_WORK_LIST_PATH = "/story/api/xhs/ability/userWorkList";

export function redfoxSearchRequestParams(
  path: string,
  keyword: string,
  page: number,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> {
  if (path.includes("/xhs/ability/")) {
    return {
      keyword,
      note_type: env.REDFOX_REALTIME_NOTE_TYPE ?? "不限",
      noteTime: env.REDFOX_REALTIME_NOTE_TIME ?? "不限",
      page: Math.max(1, page),
      // Relevance order yields more candidates that can satisfy engagement and
      // semantic filters. The downstream hard filter still enforces recency.
      sort: env.REDFOX_REALTIME_SEARCH_SORT ?? "综合",
    };
  }
  return {
    keyword,
    offset: Math.max(0, page - 1) * 20,
    sortType: env.REDFOX_SEARCH_SORT_TYPE ?? "_0",
    exactMatch: env.REDFOX_SEARCH_EXACT_MATCH === "true",
  };
}
const RESPONSE_CACHE_MAX_ENTRIES = 300;
const responseCache = new Map<string, { expiresAt: number; value?: JsonRecord; error?: string }>();

function cachedResponse(key: string): { value?: JsonRecord; error?: string } | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry;
}

function storeCachedResponse(key: string, entry: { expiresAt: number; value?: JsonRecord; error?: string }): void {
  responseCache.delete(key);
  responseCache.set(key, entry);
  while (responseCache.size > RESPONSE_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value as string | undefined;
    if (!oldest) break;
    responseCache.delete(oldest);
  }
}

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

const FOLLOWER_FIELD_NAMES = new Set([
  "followers", "follower", "followercount", "followernum", "followernumber",
  "fans", "fanscount", "fansnum", "fansnumber", "accountfans", "accountfanscount",
]);

/** RedFox occasionally nests account metrics under accountInfo/userInfo/data.
 * Search only known follower field names so note likes or other numbers are not
 * accidentally treated as a follower count. */
function firstFollowerNumberDeep(value: unknown, depth = 0): number | null {
  if (depth > 5 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstFollowerNumberDeep(item, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const normalizedKey = key.replace(/[_-]/g, "").toLowerCase();
    if (FOLLOWER_FIELD_NAMES.has(normalizedKey)) {
      const found = firstNumber(child);
      if (found !== null) return found;
    }
  }
  for (const child of Object.values(value as JsonRecord)) {
    const found = firstFollowerNumberDeep(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function arrayFrom(...values: unknown[]): unknown[] {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
}

function modelSafeImageUrl(value: string): string {
  const normalized = value.startsWith("//") ? "https:" + value : value;
  // RedFox may return HEIF/AVIF transformations. DeepSeek vision accepts webp/png/jpeg/gif.
  return normalized.replace(/format\/(?:heif|heic|avif|avifs?)/gi, "format/webp");
}
function imageUrl(...values: unknown[]): string | null {
  for (const value of values) {
    const record = asRecord(value);
    const candidate = firstString(typeof value === "string" ? value : null, record?.url, record?.url_default, record?.urlPre, record?.url_pre, record?.origin_url, record?.image_url, record?.coverImage, record?.defaultUrl, record?.hdUrl, record?.previewUrl, record?.cover_image, record?.imageUrl);
    if (candidate) return modelSafeImageUrl(candidate);
  }
  return null;
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

function likeCount(note: JsonRecord): number | null {
  return firstNumber(note.liked_count, note.like_count, note.likes, note.liked, note.thumbCount, note.thumb_count, note.likeNum, note.workLikedCount);
}

function interactionCount(note: JsonRecord): number | null {
  const values = [
    likeCount(note),
    firstNumber(note.collected_count, note.collect_count, note.collects, note.collected, note.favoriteCount, note.favorite_count, note.favNum, note.workCollectedCount),
    firstNumber(note.shared_count, note.share_count, note.shares, note.shared, note.forwardCount, note.forward_count, note.shareNum, note.workSharedCount),
    firstNumber(note.comments_count, note.comment_count, note.comments, note.replyCount, note.reply_count, note.commentCount, note.cmtNum, note.workCommentsCount),
  ].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function publicationTime(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value < 10_000_000_000 ? value * 1000 : value;
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value.trim());
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return undefined;
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

function normalizeNote(item: JsonRecord): RedfoxNoteCandidate | null {
  const note = firstRecord(item.note, item.note_info, item.post, item);
  const user = firstRecord(item.user, item.userInfo, note.user, note.userInfo, item.author, note.author, item.author_info, note.author_info);
  // RedFoxHub searchArticle/queryWorkList 返回扁平字段（accountUserid/workId/...），
  // 同时保留嵌套字段兼容其他 RedFox 数据集。
  const userId = firstString(user.id, user.user_id, user.userId, user.authorUid, user.author_uid, note.user_id, note.userId, note.authorUid, item.accountUserid, item.accountUserId, item.user_id, item.userId, item.authorUid);
  if (!userId) return null;
  const noteId = firstString(note.note_id, note.noteId, note.id, item.workId, item.work_id, item.note_id, item.noteId, item.id);
  const nickname = firstString(user.nickname, user.nick_name, user.nickName, user.name, user.authorName, note.user_nickname, note.authorName, note.name, item.accountNickname, item.nickname, item.authorName, item.name);
  const handle = firstString(user.red_id, user.redId, user.xhs_id, user.user_name, user.username, user.authorUid, item.accountId, item.redId, item.red_id);
  const profileUrl = firstString(user.profile_url, user.profileUrl, user.home_url, user.homeUrl, user.url, item.profileUrl, item.profile_url) ?? `${XHS_ORIGIN}/user/profile/${userId}`;
  const title = firstString(note.title, note.itemTitle, note.noteTitle, note.name, item.workTitle, item.title, item.itemTitle, item.noteTitle) ?? "";
  const text = firstString(note.desc, note.noteDesc, note.contentDesc, note.description, note.content, note.share_text, item.workDesc, item.desc, item.noteDesc, item.contentDesc, item.description, item.content) ?? title;
  const images = imageUrls(note.image_list, note.imageList, note.images, note.image_urls, note.imageUrls, note.cover, note.cover_url, note.coverImage, note.imagesList, note.picList, note.picUrls, note.previewUrls, item.image_list, item.images, item.coverUrl, item.cover_url, item.coverImage, item.picUrls, item.previewUrls);
  const typeValue = firstString(note.note_type, note.noteType, note.type, item.workType, item.note_type, item.noteType, item.type)?.toLowerCase() ?? "";
  const noteType: RedfoxNoteCandidate["noteType"] = typeValue.includes("video") || typeValue.includes("\u89c6\u9891") ? "video" : images.length ? "image" : "unknown";
  const publishedAt = publicationTime(item.workPublishTime, item.publishTime, item.releaseTime, item.createTime, item.publishedAt, item.createdAt, note.workPublishTime, note.publishTime, note.releaseTime, note.createTime, note.publishedAt, note.createdAt);
  return { noteId, userId, nickname, handle, profileUrl, title: title.slice(0, 200), text: text.slice(0, 4000), imageUrls: images, likes: likeCount(note), interaction: interactionCount(note), publishedAt, noteType, raw: item };
}

export function redfoxNoteKey(note: RedfoxNoteCandidate): string {
  return note.noteId ?? `${note.userId}:${note.title}:${note.text.slice(0, 80)}`;
}

export function normalizeProfile(item: JsonRecord, fallback?: RedfoxNoteCandidate): RedfoxCreatorProfile | null {
  const note = firstRecord(item.note, item.note_info, item.post, item);
  const user = firstRecord(item.user, item.userInfo, note.user, note.userInfo, item.author, note.author, item.author_info, note.author_info, item.profile, item.data);
  const id = firstString(user.id, user.user_id, user.userId, user.authorUid, user.author_uid, note.user_id, note.userId, note.authorUid, item.accountUserid, item.accountUserId, item.user_id, item.userId, item.authorUid, item.uid, fallback?.userId);
  if (!id) return null;
  const nickname = firstString(user.nickname, user.nick_name, user.nickName, user.name, user.authorName, item.accountName, item.accountNickname, item.nickname, item.authorName, item.name, fallback?.nickname);
  const handle = firstString(user.red_id, user.redId, user.xhs_id, user.user_name, user.username, user.authorUid, item.accountId, item.redId, item.red_id, fallback?.handle);
  const profileUrl = firstString(user.profile_url, user.profileUrl, user.home_url, user.homeUrl, user.url, item.profileUrl, item.profile_url, item.url, item.noteLink, item.noteUrl, fallback?.profileUrl) ?? `${XHS_ORIGIN}/user/profile/${id}`;
  const followers = firstNumber(user.followers, user.fans, user.fans_count, user.follower_count, user.fansCount, user.fansNum, user.fans_num, user.fansCount, item.accountFans, item.followers, item.fans, item.fans_count, item.fansNum, item.fansCount)
    ?? firstFollowerNumberDeep(user)
    ?? firstFollowerNumberDeep(item);
  const following = firstNumber(user.following, user.following_count, user.followCount, user.followingCount, item.accountFollows, item.followingCount);
  const likesCollected = firstNumber(user.likes_collected, user.liked_count, user.likes, user.liked, user.likeCollectCount, user.likeCount, item.accountLikes, item.accountCollectes, item.likeCollectCount, item.likeCount);
  const bio = firstString(user.desc, user.description, user.bio, user.intro, user.introduction, item.accountDesc, item.introduction, item.bio);
  const title = firstString(note.title, note.itemTitle, note.noteTitle, note.workTitle, note.name, item.workTitle, item.title, fallback?.title) ?? "Untitled note";
  const publishedAt = publicationTime(item.workPublishTime, item.publishTime, item.publishedAt, item.createdAt, note.workPublishTime, note.publishTime, note.publishedAt, note.createdAt, fallback?.publishedAt, fallback?.raw.workPublishTime, fallback?.raw.publishTime, fallback?.raw.publishedAt);
  const ownImages = imageUrls(note.image_list, note.imageList, note.images, note.image_urls, note.imageUrls, note.cover, note.cover_url, item.coverUrl, item.coverImage);
  const posts = [{
    title: title.slice(0, 100),
    likes: likeCount(note) ?? likeCount(item) ?? fallback?.likes ?? null,
    interaction: interactionCount(note) ?? interactionCount(item) ?? fallback?.interaction ?? null,
    publishedAt,
    imageUrls: ownImages.length ? ownImages : (fallback?.imageUrls ?? []),
  }];
  const avatarUrl = imageUrl(user.avatar, user.avatar_url, user.avatarUrl, user.image, user.avatarPic, item.accountAvatar, item.avatar, item.avatarUrl, item.headPhoto);
  const warnings = [] as CreatorProfileFields["warnings"];
  if (!nickname) warnings.push(FIELD_WARNING.NICKNAME_MISSING);
  if (followers === null) warnings.push(FIELD_WARNING.FOLLOWERS_MISSING);
  if (!handle) warnings.push(FIELD_WARNING.HANDLE_MISSING);
  if (!bio) warnings.push(FIELD_WARNING.BIO_MISSING);
  if (!avatarUrl) warnings.push(FIELD_WARNING.AVATAR_MISSING);
  const fields: CreatorProfileFields = { nickname, handle, ipLocation: firstString(user.ip_location, user.ipLocation, item.ipLocation, item.ip_location, item.province, item.city, item.ipRegion, item.area), bio, followers, following, likesCollected, avatarUrl, posts, imageUrls: posts.flatMap((post) => post.imageUrls), capturedAt: new Date().toISOString(), warnings, dataCompleteness: warnings.length === 0 ? "complete" : "partial" };
  return { ref: { platformCreatorId: id, profileUrl, cardNickname: nickname }, fields };
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

export class RedfoxXhsClient {
  private readonly provider = "redfox" as const;
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
  private readonly maxRequestsPerSearch: number;
  private requestCount = 0;
  private retryCount = 0;
  private cacheHitCount = 0;
  private readonly requestCountByEndpoint: Record<string, number> = {};
  private lastRequestAt = 0;

  constructor(options: RedfoxClientOptions) {
    const env = (name: string, fallback?: string) => process.env[('REDFOX_' + name)] ?? fallback;
    const apiKey = options.apiKey || env('API_KEY') || '';
    if (!apiKey.trim()) throw new Error('REDFOX_API_KEY not configured');
    this.apiKey = apiKey.trim();
    this.baseUrl = (options.baseUrl ?? env('BASE_URL', 'https://redfox.hk'))!.replace(/\/$/, '');
    this.searchPath = options.searchPath ?? env('SEARCH_PATH', '/story/api/xhsUser/searchArticle')!;
    this.imageNoteDetailPath = options.imageNoteDetailPath ?? env('NOTE_DETAIL_PATH', '/story/api/xhsUser/queryWorkDetail')!;
    this.videoNoteDetailPath = options.videoNoteDetailPath ?? env('VIDEO_NOTE_DETAIL_PATH', '/story/api/xhsUser/queryWorkDetail')!;
    this.userInfoPath = options.userInfoPath ?? env('USER_INFO_PATH', '/story/api/xhsUser/queryAccountDetail')!;
    this.userPostedNotesPath = options.userPostedNotesPath ?? env('USER_WORK_LIST_PATH', '/story/api/xhsUser/queryWorkList')!;
    // 优质库账号详情已包含粉丝、作品和互动汇总，不需要额外调用旧的 authorPerformance。
    this.authorPerformancePath = options.authorPerformancePath ?? env('AUTHOR_PERFORMANCE_PATH', '/story/api/xhsUser/queryAccountDetail')!;
    this.requestDelayMs = Math.max(300, options.requestDelayMs ?? Number(env('REQUEST_DELAY_MS', '1200')));
    this.maxRetries = Math.min(6, Math.max(0, options.maxRetries ?? Number(env('MAX_RETRIES', '3'))));
    this.backoffBaseMs = Math.max(250, options.backoffBaseMs ?? Number(env('BACKOFF_BASE_MS', '1000')));
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? Number(env('TIMEOUT_MS', '30000')));
    this.maxPages = Math.min(10, Math.max(1, options.maxPages ?? Number(env('SEARCH_PAGES', '10'))));
    const configuredRequestLimit = options.maxRequestsPerSearch ?? Number(env('MAX_REQUESTS_PER_SEARCH', '160'));
    // A non-positive value explicitly disables the local request ceiling. The
    // creator ReAct loop then stops on quality yield, target completion, source
    // exhaustion, cancellation, or a real provider response.
    this.maxRequestsPerSearch = Number.isFinite(configuredRequestLimit) && configuredRequestLimit > 0
      ? Math.max(20, configuredRequestLimit)
      : Number.POSITIVE_INFINITY;
  }

  getMetrics(): { requestCount: number; retryCount: number; cacheHitCount: number; requestCountByEndpoint: Record<string, number> } {
    return {
      requestCount: this.requestCount,
      retryCount: this.retryCount,
      cacheHitCount: this.cacheHitCount,
      requestCountByEndpoint: { ...this.requestCountByEndpoint },
    };
  }

  getRemainingRequestBudget(): number {
    return Math.max(0, this.maxRequestsPerSearch - this.requestCount);
  }

  private usesRealtimeCreatorApi(): boolean {
    return this.searchPath.includes("/xhs/ability/");
  }

  private async cachedRequest(key: string, ttlMs: number, load: () => Promise<JsonRecord>, negativeTtlMs = 0): Promise<JsonRecord> {
    const cached = cachedResponse(key);
    if (cached?.value) {
      this.cacheHitCount += 1;
      return cached.value;
    }
    if (cached?.error) {
      this.cacheHitCount += 1;
      throw new Error(cached.error);
    }
    try {
      const value = await load();
      storeCachedResponse(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (negativeTtlMs > 0 && /未查询到相关数据|暂未收录/.test(message)) {
        storeCachedResponse(key, { error: message, expiresAt: Date.now() + negativeTtlMs });
      }
      throw error;
    }
  }

  private async requestJson(path: string, params: Record<string, unknown>): Promise<JsonRecord> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const wait = this.requestDelayMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      this.lastRequestAt = Date.now();
      const normalizedPath = path.replace(/^\/+/, "");
      if (this.requestCount >= this.maxRequestsPerSearch) {
        throw new Error(`本次检索达到 RedFox 调用上限 ${this.maxRequestsPerSearch}，已停止继续消耗积分。`);
      }
      const url = new URL(normalizedPath, `${this.baseUrl}/`);
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requestCount += 1;
      this.requestCountByEndpoint[normalizedPath] = (this.requestCountByEndpoint[normalizedPath] ?? 0) + 1;
      let payloadForLog: unknown;
      try {
        const headers = { REDFOX_API_KEY: this.apiKey, "Content-Type": "application/json", Accept: "application/json" };
        const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(params), signal: controller.signal });
        const payload = await response.json().catch(() => ({})) as unknown;
        payloadForLog = payload;
        const body = Array.isArray(payload) ? { data: payload } : (asRecord(payload) ?? {});
        const businessCode = typeof body.code === "number" ? body.code : null;
        if (!response.ok || body.success === false || (businessCode !== null && businessCode !== 2000)) {
          const error = new Error(firstString(body.error, body.error_msg, body.message, body.msg, body.detail, body.title) ?? `${this.provider} request failed (HTTP ${response.status}, code ${businessCode ?? "unknown"})`);
          const retryable = RETRYABLE_STATUS.has(response.status);
          throw Object.assign(error, { status: response.status, retryable, retryAfter: Number(response.headers.get("retry-after") ?? body.retry_after ?? 0) });
        }
        void recordUsageEvent({ event: "redfox_call", provider: this.provider, status: "success", durationMs: Date.now() - started, metadata: { path: normalizedPath, attempt } });
        await recordApiLog({ module: "creator", provider: this.provider, endpoint: url.toString(), method: "POST", status: "success", statusCode: response.status, durationMs: Date.now() - started, attempt, request: params, response: payloadForLog });
        return body;
      } catch (error) {
        void recordUsageEvent({ event: "redfox_call", provider: this.provider, status: "error", durationMs: Date.now() - started, metadata: { path: normalizedPath, attempt } });
        await recordApiLog({ module: "creator", provider: this.provider, endpoint: url.toString(), method: "POST", status: "error", statusCode: Number((error as { status?: number }).status ?? 0) || undefined, durationMs: Date.now() - started, attempt, request: params, response: payloadForLog, error: error instanceof Error ? error.message : String(error) });
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
    // Newest-first realtime recall is less biased toward large accounts than
    // the quality-library ranking and better matches recent-note filters.
    const params = redfoxSearchRequestParams(this.searchPath, keyword, page);
    return this.cachedRequest(
      `search:${this.searchPath}:${keyword}:${page}:${String(params.sort ?? params.sortType ?? "")}:${String(params.noteTime ?? params.exactMatch ?? "")}`,
      5 * 60_000,
      () => this.requestJson(this.searchPath, params),
      10 * 60_000,
    );
  }
  async enrichNote(note: RedfoxNoteCandidate): Promise<RedfoxNoteCandidate> {
    // The documented realtime search API has no supported note-detail route.
    // Keep the search payload rather than calling the undocumented
    // /xhs/ability/notePerformance endpoint.
    if (this.usesRealtimeCreatorApi()) return note;
    if (!note.noteId) return note;
    let payload: JsonRecord | null = null;
    try { payload = note.noteType === "video" ? await this.getVideoNoteDetail(note.noteId) : await this.getImageNoteDetail(note.noteId); } catch {
      if (note.noteType !== "video") { try { payload = await this.getVideoNoteDetail(note.noteId); } catch { return note; } } else return note;
    }
    const detail = firstRecord(Array.isArray(payload?.data) ? payload.data[0] : payload?.data, payload?.result, payload?.note, payload);
    const normalized = normalizeNote({ ...detail, user: firstRecord(detail.user, note.raw.user) });
    if (!normalized) return note;
    return {
      ...note,
      title: normalized.title || note.title,
      text: normalized.text || note.text,
      imageUrls: note.noteType === "video" ? [] : (normalized.imageUrls.length ? normalized.imageUrls : note.imageUrls),
      likes: normalized.likes ?? note.likes,
      interaction: normalized.interaction ?? note.interaction,
      publishedAt: normalized.publishedAt ?? note.publishedAt,
      raw: { ...note.raw, detail },
    };
  }

  async getImageNoteDetail(noteId: string): Promise<JsonRecord> {
    return this.cachedRequest(`note:image:${this.imageNoteDetailPath}:${noteId}`, 6 * 60 * 60_000, () => this.requestJson(this.imageNoteDetailPath, { workId: noteId }));
  }
  async getVideoNoteDetail(noteId: string): Promise<JsonRecord> {
    return this.cachedRequest(`note:video:${this.videoNoteDetailPath}:${noteId}`, 6 * 60 * 60_000, () => this.requestJson(this.videoNoteDetailPath, { workId: noteId }));
  }
  async getUserInfo(userId: string, accountId?: string): Promise<JsonRecord> {
    return this.cachedRequest(`account:${userId}:${accountId ?? userId}`, 6 * 60 * 60_000, () => this.requestJson(this.userInfoPath, { accountId: accountId ?? userId, userId }));
  }
  async getUserPostedNotes(userId: string, redId?: string): Promise<JsonRecord> {
    const path = this.usesRealtimeCreatorApi() ? REALTIME_USER_WORK_LIST_PATH : this.userPostedNotesPath;
    const params = this.usesRealtimeCreatorApi() ? { userId, offset: "" } : { userid: userId, redId, offset: 0, sortType: '_0' };
    return this.cachedRequest(`works:${path}:${userId}:${redId ?? ""}`, 30 * 60_000, () => this.requestJson(path, params));
  }

  async getAuthorPerformance(userId: string): Promise<JsonRecord> {
      return this.requestJson(this.authorPerformancePath, { accountId: userId, userId });
  }
  async searchNoteCandidates(keywordsInput: string | string[], targetCount: number): Promise<RedfoxNoteCollectResult> {
    const notes: RedfoxNoteCandidate[] = [];
    const seen = new Set<string>();
    const unavailableKeywords = new Set<string>();
    const keywordFailures: RedfoxNoteCollectResult["keywordFailures"] = [];
    const keywords = Array.from(new Set((Array.isArray(keywordsInput) ? keywordsInput : [keywordsInput]).map((item) => item.trim()).filter(Boolean))).slice(0, 32);
    if (!keywords.length) return { notes, pages: 0, keywords: [], keywordFailures, ...this.getMetrics() };
    // 复杂意图按主题分路检索；总页数有界，避免关键词数量线性放大 API 消耗。
    const creatorTarget = Math.max(targetCount * 2, 60);
    const uniqueCreators = new Set<string>();
    const additionalPageBudget = Math.min(4, keywords.length) * Math.max(0, this.maxPages - 1);
    const totalPageLimit = Math.min(12, keywords.length + additionalPageBudget);
    let pages = 0;
    searchPages: for (let page = 1; page <= this.maxPages && pages < totalPageLimit; page += 1) {
      for (const keyword of keywords) {
        if (pages >= totalPageLimit || (page > 1 && uniqueCreators.size >= creatorTarget)) break;
        if (unavailableKeywords.has(keyword)) continue;
        pages += 1;
        let payload: JsonRecord;
        try {
          payload = await this.searchNotes(keyword, page);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          keywordFailures.push({
            keyword,
            page,
            error: message,
          });
          if (/未查询到相关数据|暂未收录/.test(message)) unavailableKeywords.add(keyword);
          if (/积分余额不足|余额不足|剩余积分\s*0(?:\.0)?|API\s*Key.*(?:禁用|无效|过期)|密钥.*(?:禁用|无效|过期)/i.test(message)) break searchPages;
          continue;
        }
        for (const item of candidateItems(payload)) {
          const note = normalizeNote(item);
          if (!note) continue;
          const key = note.noteId ?? `${note.userId}:${note.title}:${note.text.slice(0, 80)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          notes.push(note);
          uniqueCreators.add(note.userId);
          if (page > 1 && uniqueCreators.size >= creatorTarget) break;
        }
      }
      if (uniqueCreators.size >= creatorTarget) break;
    }
    return { notes, pages, keywords, keywordFailures, ...this.getMetrics() };
  }


  async searchNextNoteBatch(
    keywordsInput: string | string[],
    options: {
      cursor?: Partial<RedfoxSearchCursor>;
      excludedNoteKeys?: Iterable<string>;
      excludedCreatorIds?: Iterable<string>;
      desiredCreators?: number;
      pageBudget?: number;
      minimumPages?: number;
    } = {},
  ): Promise<RedfoxNoteBatchResult> {
    const notes: RedfoxNoteCandidate[] = [];
    const seen = new Set(options.excludedNoteKeys ?? []);
    const excludedCreators = new Set(options.excludedCreatorIds ?? []);
    const uniqueCreators = new Set<string>();
    const keywordFailures: RedfoxNoteCollectResult["keywordFailures"] = [];
    // Keep the same keyword capacity as the keyword builder/search collector.  The
    // persisted cursor may already have exhausted the first group of phrases; if
    // we truncate back to eight here, newly generated long-tail phrases are never
    // visited and the task incorrectly finishes without issuing a RedFox request.
    const keywords = Array.from(new Set((Array.isArray(keywordsInput) ? keywordsInput : [keywordsInput]).map((item) => item.trim()).filter(Boolean))).slice(0, 32);
    const nextPageByKeyword = { ...(options.cursor?.nextPageByKeyword ?? {}) };
    const exhausted = new Set(options.cursor?.exhaustedKeywords ?? []);
    let nextKeywordIndex = Math.max(0, Number(options.cursor?.nextKeywordIndex ?? 0)) % Math.max(keywords.length, 1);
    const desiredCreators = Math.max(1, options.desiredCreators ?? 20);
    const pageBudget = Math.max(
      1,
      Math.min(options.pageBudget ?? keywords.length, Math.max(1, keywords.length * this.maxPages)),
    );
    const minimumPages = Math.max(0, Math.min(options.minimumPages ?? 0, pageBudget));
    const attempted = new Set<string>();
    let pages = 0;

    while (keywords.length && pages < pageBudget && (uniqueCreators.size < desiredCreators || pages < minimumPages) && exhausted.size < keywords.length) {
      let selected: { keyword: string; index: number; page: number } | null = null;
      for (let offset = 0; offset < keywords.length; offset += 1) {
        const index = (nextKeywordIndex + offset) % keywords.length;
        const keyword = keywords[index];
        if (exhausted.has(keyword)) continue;
        const page = Math.max(1, Number(nextPageByKeyword[keyword] ?? 1));
        if (page > this.maxPages) {
          exhausted.add(keyword);
          continue;
        }
        const attemptKey = `${keyword}:${page}`;
        if (attempted.has(attemptKey)) continue;
        selected = { keyword, index, page };
        break;
      }
      if (!selected) break;
      attempted.add(`${selected.keyword}:${selected.page}`);
      nextKeywordIndex = (selected.index + 1) % keywords.length;
      pages += 1;
      let payload: JsonRecord;
      try {
        payload = await this.searchNotes(selected.keyword, selected.page);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        keywordFailures.push({ keyword: selected.keyword, page: selected.page, error: message });
        if (/未查询到相关数据|暂未收录/.test(message)) exhausted.add(selected.keyword);
        if (/积分余额不足|余额不足|剩余积分\s*0(?:\.0)?|RedFox 调用上限|API\s*Key.*(?:禁用|无效|过期)|密钥.*(?:禁用|无效|过期)/i.test(message)) break;
        continue;
      }
      const items = candidateItems(payload);
      nextPageByKeyword[selected.keyword] = selected.page + 1;
      if (!items.length || selected.page >= this.maxPages) exhausted.add(selected.keyword);
      for (const item of items) {
        const note = normalizeNote(item);
        if (!note) continue;
        const key = redfoxNoteKey(note);
        if (seen.has(key) || excludedCreators.has(note.userId)) continue;
        seen.add(key);
        notes.push(note);
        uniqueCreators.add(note.userId);
      }
    }

    return {
      notes,
      pages,
      keywords,
      keywordFailures,
      cursor: { nextPageByKeyword, exhaustedKeywords: [...exhausted], nextKeywordIndex },
      sourceExhausted: keywords.length === 0 || exhausted.size >= keywords.length,
      ...this.getMetrics(),
    };
  }

  async hydrateCreatorProfile(note: RedfoxNoteCandidate, options: { includePostedNotes?: boolean; includeNoteDetail?: boolean } = {}): Promise<RedfoxCreatorHydration> {
    let noteInfo: JsonRecord = {};
    let noteDetailError: string | null = null;
    let accountDetailError: string | null = null;
    let postedNotesError: string | null = null;
    // Realtime discovery only uses documented routes. Legacy search can still
    // opt into its documented queryWorkDetail endpoint.
    if (options.includeNoteDetail === true && !this.usesRealtimeCreatorApi()) {
      try {
        noteInfo = note.noteId
          ? (note.noteType === 'video' ? await this.getVideoNoteDetail(note.noteId) : await this.getImageNoteDetail(note.noteId))
          : {};
      } catch (error) {
        noteDetailError = error instanceof Error ? error.message : String(error);
      }
    }
    const noteDetail = firstRecord(noteInfo.data, noteInfo.result, noteInfo.note, noteInfo);
    let profile = normalizeProfile({ ...note.raw, ...noteDetail, ...noteInfo }, note);

    // Fetch the documented account-detail endpoint only when discovery did not
    // already include a follower count.
    if (profile?.fields.followers === null || profile?.fields.followers === undefined) try {
      const userInfo = await this.getUserInfo(note.userId, note.handle ?? undefined);
      const userDetail = firstRecord(userInfo.data, userInfo.result, userInfo.user, userInfo);
      const enriched = normalizeProfile({
        ...note.raw,
        ...noteDetail,
        ...userDetail,
        ...userInfo,
        user: firstRecord(
          userDetail.userInfo,
          userInfo.userInfo,
          userDetail.user,
          userInfo.user,
          userDetail,
          note.raw.user,
          note.raw.userInfo,
        ),
      }, note);
      if (enriched) profile = enriched;
    } catch (error) {
      accountDetailError = error instanceof Error ? error.message : String(error);
    }

    if (!profile) return { profile: null, noteDetailError, accountDetailError, postedNotesError };
    if (options.includePostedNotes === true) {
      const postedHydration = await this.hydrateCreatorPostedNotes(note, profile);
      profile = postedHydration.profile;
      postedNotesError = postedHydration.postedNotesError;
    }
    return { profile, noteDetailError, accountDetailError, postedNotesError };
  }

  async hydrateCreatorPostedNotes(note: RedfoxNoteCandidate, profile: RedfoxCreatorProfile): Promise<{ profile: RedfoxCreatorProfile; postedNotesError: string | null }> {
    const enriched: RedfoxCreatorProfile = {
      ref: { ...profile.ref },
      fields: {
        ...profile.fields,
        posts: [...profile.fields.posts],
        imageUrls: [...profile.fields.imageUrls],
      },
    };
    let postedNotesError: string | null = null;
    try {
      const posted = await this.getUserPostedNotes(note.userId, note.handle ?? undefined);
      for (const item of candidateItems(posted)) {
        const extra = normalizeProfile(item, note);
        if (!extra) continue;
        enriched.fields.posts.push(...extra.fields.posts);
        enriched.fields.imageUrls = Array.from(new Set([...enriched.fields.imageUrls, ...extra.fields.imageUrls])).slice(0, 24);
      }
    } catch (error) {
      postedNotesError = error instanceof Error ? error.message : String(error);
    }
    const seenPosts = new Set<string>();
    enriched.fields.posts = enriched.fields.posts.filter((post) => {
      const key = `${post.title}:${post.publishedAt ?? ""}:${post.likes ?? ""}`;
      if (seenPosts.has(key)) return false;
      seenPosts.add(key);
      return true;
    });
    return { profile: enriched, postedNotesError };
  }
}
 
export function createRedfoxXhsClient(env: object): RedfoxXhsClient {
  const source = env as Record<string, string | undefined>;
  return new RedfoxXhsClient({
    apiKey: source.REDFOX_API_KEY ?? '',
    baseUrl: source.REDFOX_BASE_URL,
    // Creator discovery defaults to RedFox realtime search. The former
    // xhsUser/searchArticle endpoint is a curated quality library dominated by
    // large accounts and cannot reliably recall 1k-5k follower creators.
    searchPath: source.REDFOX_CREATOR_SEARCH_PATH ?? REALTIME_SEARCH_PATH,
    imageNoteDetailPath: source.REDFOX_NOTE_DETAIL_PATH,
    videoNoteDetailPath: source.REDFOX_VIDEO_NOTE_DETAIL_PATH,
    userInfoPath: source.REDFOX_USER_INFO_PATH,
    userPostedNotesPath: source.REDFOX_USER_WORK_LIST_PATH ?? source.REDFOX_USER_POSTED_NOTES_PATH,
    authorPerformancePath: source.REDFOX_AUTHOR_PERFORMANCE_PATH,
    requestDelayMs: Number(source.REDFOX_REQUEST_DELAY_MS ?? 1200),
    maxRetries: Number(source.REDFOX_MAX_RETRIES ?? 3),
    backoffBaseMs: Number(source.REDFOX_BACKOFF_BASE_MS ?? 1000),
    timeoutMs: Number(source.REDFOX_TIMEOUT_MS ?? 30000),
    maxPages: Number(source.REDFOX_SEARCH_MAX_PAGES_PER_KEYWORD ?? 10),
    maxRequestsPerSearch: Number(source.REDFOX_MAX_REQUESTS_PER_SEARCH ?? 160),
  });
}
