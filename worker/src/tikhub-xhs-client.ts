import type { CreatorProfileFields, SearchCreatorRef } from "./xhs-field-mapper.js";
import { FIELD_WARNING, XHS_ORIGIN } from "./xhs-constants.js";

/**
 * TikHub 的小红书数据适配器。
 *
 * 这是临时数据源，不代表小红书官方 API。Token 只从服务端环境变量读取，
 * 日志中不输出 Authorization、响应正文或 Cookie。
 */
export interface TikHubCreatorProfile {
  ref: SearchCreatorRef;
  fields: CreatorProfileFields;
}

export interface TikHubCollectResult {
  profiles: TikHubCreatorProfile[];
  source: "tikhub" | "douyin";
  pages: number;
  requestCount: number;
  retryCount: number;
}

export interface TikHubClientOptions {
  token: string;
  baseUrl?: string;
  searchPath?: string;
  imageNoteDetailPath?: string;
  videoNoteDetailPath?: string;
  userInfoPath?: string;
  userPostedNotesPath?: string;
  requestDelayMs?: number;
  maxRetries?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  maxPages?: number;
}

type JsonRecord = Record<string, unknown>;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_SEARCH_PATH = "/api/v1/xiaohongshu/app_v2/search_notes";
const DEFAULT_IMAGE_NOTE_DETAIL_PATH = "/api/v1/xiaohongshu/app_v2/get_image_note_detail";
const DEFAULT_VIDEO_NOTE_DETAIL_PATH = "/api/v1/xiaohongshu/app_v2/get_video_note_detail";
const DEFAULT_USER_INFO_PATH = "/api/v1/xiaohongshu/app_v2/get_user_info";
const DEFAULT_USER_POSTED_NOTES_PATH = "/api/v1/xiaohongshu/app_v2/get_user_posted_notes";

export interface TikHubSearchNotesParams {
  keyword: string;
  page?: number;
  sort_type?: string;
  note_type?: string;
  time_filter?: string;
  search_id?: string;
  search_session_id?: string;
  source?: string;
  ai_mode?: boolean | string;
}

export interface TikHubNoteDetailParams {
  note_id?: string;
  share_text?: string;
}

export interface TikHubUserParams {
  user_id?: string;
  share_text?: string;
}

export interface TikHubUserPostedNotesParams extends TikHubUserParams {
  cursor?: string;
  page?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
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
    const raw = value.trim().replace(/,/g, "");
    const match = raw.match(/([\d.]+)\s*([万wW千kK])?/i);
    if (!match) continue;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) continue;
    const unit = match[2]?.toLowerCase();
    const multiplier = unit === "万" ? 10_000 : unit === "千" ? 1_000 : unit === "w" ? 10_000 : unit === "k" ? 1_000 : 1;
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
  return firstString(
    typeof value === "string" ? value : null,
    record?.url,
    record?.url_default,
    record?.urlPre,
    record?.url_pre,
    record?.origin_url,
  );
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
    firstNumber(note.liked_count, note.like_count, note.likes, note.liked),
    firstNumber(note.collected_count, note.collect_count, note.collects, note.collected),
    firstNumber(note.shared_count, note.share_count, note.shares, note.shared),
    firstNumber(note.comments_count, note.comment_count, note.comments),
  ];
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

function candidateItems(payload: JsonRecord): JsonRecord[] {
  const roots: unknown[] = [
    payload.data,
    asRecord(payload.data)?.data,
    payload.result,
    asRecord(payload.result)?.data,
    payload.items,
    payload.notes,
    payload.users,
  ];
  for (const root of roots) {
    const record = asRecord(root);
    const items = arrayFrom(record?.items, record?.notes, record?.users, record?.list, record?.hits, root);
    if (items.length) return items.map((item) => asRecord(item)).filter((item): item is JsonRecord => Boolean(item));
  }
  return [];
}

function normalizeProfile(item: JsonRecord): TikHubCreatorProfile | null {
  const note = firstRecord(item.note, item.note_info, item.post, item);
  const user = firstRecord(item.user, note.user, item.author, note.author, item.author_info, note.author_info);
  const id = firstString(
    user.id,
    user.user_id,
    user.userId,
    note.user_id,
    note.userId,
    item.user_id,
    item.userId,
  );
  if (!id) return null;

  const nickname = firstString(user.nickname, user.nick_name, user.name, note.user_nickname, item.nickname);
  const handle = firstString(user.red_id, user.redId, user.xhs_id, user.user_name, user.username);
  const profileUrl = firstString(user.profile_url, user.profileUrl, user.home_url, user.homeUrl)
    ?? `${XHS_ORIGIN}/user/profile/${id}`;
  const followers = firstNumber(user.followers, user.fans, user.fans_count, user.follower_count, user.fansCount);
  const following = firstNumber(user.following, user.following_count, user.followCount);
  const likesCollected = firstNumber(user.likes_collected, user.liked_count, user.likes, user.liked);
  const bio = firstString(user.desc, user.description, user.bio, user.intro, user.introduction);
  const noteTitle = firstString(note.title, note.name, note.desc, note.description) ?? "小红书公开内容";
  const postImages = imageUrls(note.image_list, note.imageList, note.images, note.image_urls, note.imageUrls, note.cover, note.cover_url);
  const avatarUrl = imageUrl(user.avatar, user.avatar_url, user.avatarUrl, user.image);
  const warnings = [] as CreatorProfileFields["warnings"];
  if (!nickname) warnings.push(FIELD_WARNING.NICKNAME_MISSING);
  if (followers === null) warnings.push(FIELD_WARNING.FOLLOWERS_MISSING);
  if (!handle) warnings.push(FIELD_WARNING.HANDLE_MISSING);
  if (!bio) warnings.push(FIELD_WARNING.BIO_MISSING);
  if (!avatarUrl) warnings.push(FIELD_WARNING.AVATAR_MISSING);

  const fields: CreatorProfileFields = {
    nickname,
    handle,
    ipLocation: firstString(user.ip_location, user.ipLocation),
    bio,
    followers,
    following,
    likesCollected,
    avatarUrl,
    posts: [{ title: noteTitle.slice(0, 100), interaction: interactionCount(note), imageUrls: postImages }],
    imageUrls: postImages,
    capturedAt: new Date().toISOString(),
    warnings,
    dataCompleteness: warnings.length === 0 ? "complete" : "partial",
  };

  return {
    ref: { platformCreatorId: id, profileUrl, cardNickname: nickname },
    fields,
  };
}

export class TikHubXhsClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly searchPath: string;
  private readonly imageNoteDetailPath: string;
  private readonly videoNoteDetailPath: string;
  private readonly userInfoPath: string;
  private readonly userPostedNotesPath: string;
  private readonly requestDelayMs: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private requestCount = 0;
  private retryCount = 0;
  private lastRequestAt = 0;

  constructor(options: TikHubClientOptions) {
    if (!options.token.trim()) throw new Error("TIKHUB_TOKEN 未配置");
    this.token = options.token.trim();
    this.baseUrl = (options.baseUrl ?? process.env.TIKHUB_BASE_URL ?? "https://api.tikhub.io").replace(/\/$/, "");
    this.searchPath = options.searchPath ?? process.env.TIKHUB_SEARCH_PATH ?? DEFAULT_SEARCH_PATH;
    this.imageNoteDetailPath = options.imageNoteDetailPath ?? process.env.TIKHUB_IMAGE_NOTE_DETAIL_PATH ?? DEFAULT_IMAGE_NOTE_DETAIL_PATH;
    this.videoNoteDetailPath = options.videoNoteDetailPath ?? process.env.TIKHUB_VIDEO_NOTE_DETAIL_PATH ?? DEFAULT_VIDEO_NOTE_DETAIL_PATH;
    this.userInfoPath = options.userInfoPath ?? process.env.TIKHUB_USER_INFO_PATH ?? DEFAULT_USER_INFO_PATH;
    this.userPostedNotesPath = options.userPostedNotesPath ?? process.env.TIKHUB_USER_POSTED_NOTES_PATH ?? DEFAULT_USER_POSTED_NOTES_PATH;
    this.requestDelayMs = Math.max(300, options.requestDelayMs ?? Number(process.env.TIKHUB_REQUEST_DELAY_MS ?? 1200));
    this.maxRetries = Math.min(6, Math.max(0, options.maxRetries ?? Number(process.env.TIKHUB_MAX_RETRIES ?? 3)));
    this.backoffBaseMs = Math.max(250, options.backoffBaseMs ?? Number(process.env.TIKHUB_BACKOFF_BASE_MS ?? 1000));
    this.timeoutMs = Math.max(5_000, options.timeoutMs ?? Number(process.env.TIKHUB_TIMEOUT_MS ?? 30_000));
    this.maxPages = Math.min(10, Math.max(1, options.maxPages ?? Number(process.env.TIKHUB_SEARCH_PAGES ?? 2)));
  }

  protected getMetrics(): { requestCount: number; retryCount: number } {
    return { requestCount: this.requestCount, retryCount: this.retryCount };
  }

  protected async throttle(): Promise<void> {
    const wait = this.requestDelayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  protected async getJson(path: string, params: Record<string, string | number>): Promise<JsonRecord> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.throttle();
      const url = new URL(path, `${this.baseUrl}/`);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requestCount += 1;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable = RETRYABLE_STATUS.has(response.status);
          const retryAfter = Number(response.headers.get("retry-after") ?? "0");
          throw Object.assign(new Error(`TikHub 请求失败（HTTP ${response.status}）`), { status: response.status, retryable, retryAfter });
        }
        const payload = await response.json() as unknown;
        const record = asRecord(payload);
        if (!record) throw new Error("TikHub 返回了非 JSON 对象");
        if (record.success === false) throw new Error(firstString(record.error_msg, record.message, record.msg) ?? "TikHub 返回业务错误");
        return record;
      } catch (error) {
        lastError = error;
        const status = Number((error as { status?: number }).status ?? 0);
        const retryable = Boolean((error as { retryable?: boolean }).retryable) || !status;
        if (!retryable || attempt >= this.maxRetries) break;
        this.retryCount += 1;
        const retryAfter = Number((error as { retryAfter?: number }).retryAfter ?? 0);
        const backoff = retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : Math.min(60_000, this.backoffBaseMs * (2 ** attempt));
        const jitter = Math.floor(Math.random() * Math.min(500, this.backoffBaseMs));
        await sleep(backoff + jitter);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("TikHub 请求失败");
  }

  protected async postJson(path: string, body: Record<string, unknown>): Promise<JsonRecord> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.throttle();
      const url = new URL(path, `${this.baseUrl}/`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      this.requestCount += 1;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const retryable = RETRYABLE_STATUS.has(response.status);
          const retryAfter = Number(response.headers.get('retry-after') ?? '0');
          throw Object.assign(new Error(`TikHub HTTP ${response.status}`), { status: response.status, retryable, retryAfter });
        }
        const payload = await response.json() as unknown;
        const record = asRecord(payload);
        if (!record) throw new Error('TikHub returned a non-JSON object');
        if (record.success === false) throw new Error(firstString(record.error_msg, record.message, record.msg) ?? 'TikHub business error');
        return record;
      } catch (error) {
        lastError = error;
        const status = Number((error as { status?: number }).status ?? 0);
        const retryable = Boolean((error as { retryable?: boolean }).retryable) || !status;
        if (!retryable || attempt >= this.maxRetries) break;
        this.retryCount += 1;
        const retryAfter = Number((error as { retryAfter?: number }).retryAfter ?? 0);
        const backoff = retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : Math.min(60_000, this.backoffBaseMs * (2 ** attempt));
        const jitter = Math.floor(Math.random() * Math.min(500, this.backoffBaseMs));
        await sleep(backoff + jitter);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('TikHub request failed');
  }
  private queryParams(input: Record<string, unknown>): Record<string, string | number> {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '').map(([key, value]) => [key, value as string | number]));
  }

  async searchNotes(params: TikHubSearchNotesParams): Promise<JsonRecord> {
    const keyword = params.keyword.trim();
    if (!keyword) throw new Error('TikHub search_notes 要求 keyword');
    return this.getJson(this.searchPath, this.queryParams(params));
  }

  private ensureNoteIdentifier(params: TikHubNoteDetailParams | TikHubUserParams): void {
    if (!(params.note_id?.trim() || params.user_id?.trim() || params.share_text?.trim())) {
      throw new Error('TikHub 请求需要 note_id、user_id 或 share_text');
    }
  }

  async getImageNoteDetail(params: TikHubNoteDetailParams): Promise<JsonRecord> {
    this.ensureNoteIdentifier(params);
    return this.getJson(this.imageNoteDetailPath, this.queryParams(params));
  }

  async getVideoNoteDetail(params: TikHubNoteDetailParams): Promise<JsonRecord> {
    this.ensureNoteIdentifier(params);
    return this.getJson(this.videoNoteDetailPath, this.queryParams(params));
  }

  async getUserInfo(params: TikHubUserParams): Promise<JsonRecord> {
    this.ensureNoteIdentifier(params);
    return this.getJson(this.userInfoPath, this.queryParams(params));
  }

  async getUserPostedNotes(params: TikHubUserPostedNotesParams): Promise<JsonRecord> {
    this.ensureNoteIdentifier(params);
    return this.getJson(this.userPostedNotesPath, this.queryParams(params));
  }

  async collectCreatorProfiles(keyword: string, targetCount: number): Promise<TikHubCollectResult> {
    const byCreator = new Map<string, TikHubCreatorProfile>();
    const pages = Math.min(this.maxPages, Math.max(1, Math.ceil(Math.max(targetCount, 1) / 20)));
    for (let page = 1; page <= pages && byCreator.size < targetCount; page += 1) {
      const payload = await this.searchNotes({ keyword, page, sort_type: "general", note_type: "不限" });
      for (const item of candidateItems(payload)) {
        const profile = normalizeProfile(item);
        if (!profile) continue;
        const current = byCreator.get(profile.ref.platformCreatorId);
        if (!current) byCreator.set(profile.ref.platformCreatorId, profile);
        else {
          current.fields.posts.push(...profile.fields.posts);
          current.fields.imageUrls = Array.from(new Set([...current.fields.imageUrls, ...profile.fields.imageUrls])).slice(0, 24);
        }
        if (byCreator.size >= targetCount) break;
      }
    }
    return { profiles: Array.from(byCreator.values()), source: "tikhub", pages, requestCount: this.requestCount, retryCount: this.retryCount };
  }
}

export function createTikHubXhsClient(env: Record<string, string | undefined>): TikHubXhsClient {
  return new TikHubXhsClient({
    token: env.TIKHUB_TOKEN ?? "",
    baseUrl: env.TIKHUB_BASE_URL,
    searchPath: env.TIKHUB_SEARCH_PATH,
    imageNoteDetailPath: env.TIKHUB_IMAGE_NOTE_DETAIL_PATH,
    videoNoteDetailPath: env.TIKHUB_VIDEO_NOTE_DETAIL_PATH,
    userInfoPath: env.TIKHUB_USER_INFO_PATH,
    userPostedNotesPath: env.TIKHUB_USER_POSTED_NOTES_PATH,
  });
}
