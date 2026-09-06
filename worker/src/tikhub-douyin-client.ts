import type { CreatorProfileFields } from "./xhs-field-mapper.js";
import { FIELD_WARNING } from "./xhs-constants.js";
import {
  TikHubXhsClient,
  type TikHubClientOptions,
  type TikHubCreatorProfile,
  type TikHubCollectResult,
} from "./tikhub-xhs-client.js";

type JsonRecord = Record<string, unknown>;

const DEFAULT_USER_SEARCH_PATH = "/api/v1/douyin/search/fetch_user_search";
const DEFAULT_VIDEO_DETAIL_PATH = "/api/v1/douyin/app/v3/fetch_one_video_v3";
const DEFAULT_VIDEO_STATS_PATH = "/api/v1/douyin/app/v3/fetch_video_statistics";
const DEFAULT_USER_PROFILE_PATH = "/api/v1/douyin/web/handler_user_profile";
const DEFAULT_USER_POSTS_PATH = "/api/v1/douyin/app/v3/fetch_user_post_videos";
const DEFAULT_USER_FANS_PATH = "/api/v1/douyin/app/v3/fetch_user_fans_list";

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
    const match = value.replace(/,/g, "").match(/([\d.]+)\s*([万wW千kK])?/);
    if (!match) continue;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) continue;
    const unit = match[2]?.toLowerCase();
    return Math.round(base * (unit === "万" || unit === "w" ? 10_000 : unit === "千" || unit === "k" ? 1_000 : 1));
  }
  return null;
}

function arrayFrom(...values: unknown[]): unknown[] {
  for (const value of values) if (Array.isArray(value)) return value;
  return [];
}

function candidateItems(payload: JsonRecord): JsonRecord[] {
  const roots: unknown[] = [
    payload.data,
    payload.result,
    payload.users,
    payload.items,
    asRecord(payload.data)?.data,
    asRecord(payload.data)?.user_list,
    asRecord(payload.data)?.user_info_list,
    asRecord(payload.data)?.users,
    asRecord(payload.data)?.items,
  ];
  for (const root of roots) {
    const record = asRecord(root);
    const items = arrayFrom(record?.user_list, record?.user_info_list, record?.users, record?.items, record?.list, root);
    const records = items.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
    if (records.length) return records;
  }
  return [];
}

function canonicalProfileUrl(id: string): string {
  return "https://www.douyin.com/user/" + id;
}

function interactionCount(item: JsonRecord): number | null {
  const stats = firstRecord(item.statistics, item.stats, item.statistic);
  const values = [
    firstNumber(stats.digg_count, item.digg_count, item.like_count, item.likes),
    firstNumber(stats.comment_count, item.comment_count, item.comments),
    firstNumber(stats.share_count, item.share_count, item.shares),
    firstNumber(stats.collect_count, item.collect_count, item.collects),
    firstNumber(stats.play_count, item.play_count, item.plays, item.views),
  ].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function profileFromItem(item: JsonRecord): TikHubCreatorProfile | null {
  const user = firstRecord(item.user_info, item.user, item.author, item);
  const id = firstString(
    user.sec_user_id,
    user.sec_uid,
    user.secUid,
    item.sec_user_id,
    item.sec_uid,
    user.uid,
    user.user_id,
    item.user_id,
  );
  if (!id) return null;
  const nickname = firstString(user.nickname, user.nick_name, user.name, item.nickname) ?? "未知抖音达人";
  const handle = firstString(user.unique_id, user.short_id, user.douyin_id, item.unique_id);
  const profileUrl = firstString(user.profile_url, user.home_url, item.profile_url) ?? canonicalProfileUrl(id);
  const avatarUrl = firstString(user.avatar, user.avatar_url, user.avatar_thumb, user.avatar_larger, item.avatar);
  const followers = firstNumber(user.follower_count, user.followers, user.fans_count, user.fans, item.follower_count);
  const bio = firstString(user.signature, user.desc, user.description, item.signature);
  const warnings = [] as CreatorProfileFields["warnings"];
  if (!nickname) warnings.push(FIELD_WARNING.NICKNAME_MISSING);
  if (followers === null) warnings.push(FIELD_WARNING.FOLLOWERS_MISSING);
  if (!handle) warnings.push(FIELD_WARNING.HANDLE_MISSING);
  if (!bio) warnings.push(FIELD_WARNING.BIO_MISSING);
  if (!avatarUrl) warnings.push(FIELD_WARNING.AVATAR_MISSING);
  return {
    ref: { platformCreatorId: id, profileUrl, cardNickname: nickname },
    fields: {
      nickname,
      handle,
      ipLocation: firstString(user.ip_location, user.ipLocation),
      bio,
      followers,
      following: firstNumber(user.following_count, user.following),
      likesCollected: firstNumber(user.total_favorited, user.likes, user.liked_count),
      avatarUrl,
      posts: [],
      imageUrls: [],
      capturedAt: new Date().toISOString(),
      warnings,
      dataCompleteness: warnings.length === 0 ? "complete" : "partial",
    },
  };
}

function mergeProfile(base: TikHubCreatorProfile, detail: JsonRecord): void {
  const user = firstRecord(detail.data, detail.user_info, detail.user, detail);
  const nickname = firstString(user.nickname, user.nick_name, user.name);
  const handle = firstString(user.unique_id, user.short_id, user.douyin_id);
  const bio = firstString(user.signature, user.desc, user.description);
  const avatarUrl = firstString(user.avatar, user.avatar_url, user.avatar_larger);
  const followers = firstNumber(user.follower_count, user.followers, user.fans_count, user.fans);
  if (nickname) base.fields.nickname = nickname;
  if (handle) base.fields.handle = handle;
  if (bio) base.fields.bio = bio;
  if (avatarUrl) base.fields.avatarUrl = avatarUrl;
  if (followers !== null) base.fields.followers = followers;
  base.fields.warnings = base.fields.warnings.filter((warning) =>
    (warning !== FIELD_WARNING.NICKNAME_MISSING || Boolean(base.fields.nickname))
    && (warning !== FIELD_WARNING.HANDLE_MISSING || Boolean(base.fields.handle))
    && (warning !== FIELD_WARNING.BIO_MISSING || Boolean(base.fields.bio))
    && (warning !== FIELD_WARNING.FOLLOWERS_MISSING || base.fields.followers !== null)
    && (warning !== FIELD_WARNING.AVATAR_MISSING || Boolean(base.fields.avatarUrl)),
  );
  base.fields.dataCompleteness = base.fields.warnings.length === 0 ? "complete" : "partial";
}

function videoItems(payload: JsonRecord): JsonRecord[] {
  const roots: unknown[] = [payload.data, payload.result, asRecord(payload.data)?.data, asRecord(payload.data)?.aweme_list, asRecord(payload.data)?.aweme_list_v2, asRecord(payload.data)?.items];
  for (const root of roots) {
    const record = asRecord(root);
    const items = arrayFrom(record?.aweme_list, record?.aweme_list_v2, record?.items, record?.list, root);
    const records = items.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
    if (records.length) return records;
  }
  return [];
}

function videoId(video: JsonRecord): string | null {
  return firstString(video.aweme_id, video.awemeId, video.item_id, video.id, asRecord(video.aweme_info)?.aweme_id);
}

function videoCaption(video: JsonRecord): string | null {
  const info = firstRecord(video.aweme_info, video.video_info);
  return firstString(video.desc, video.title, video.share_title, video.caption, video.text, info.desc, info.title);
}

function statisticItems(payload: JsonRecord): JsonRecord[] {
  const roots: unknown[] = [payload.data, payload.result, asRecord(payload.data)?.data, asRecord(payload.data)?.statistics];
  for (const root of roots) {
    const items = arrayFrom(asRecord(root)?.items, asRecord(root)?.statistics, root);
    const records = items.map(asRecord).filter((item): item is JsonRecord => Boolean(item));
    if (records.length) return records;
  }
  return [];
}

export interface TikHubDouyinClientOptions extends TikHubClientOptions {
  userSearchPath?: string;
  videoDetailPath?: string;
  videoStatsPath?: string;
  userProfilePath?: string;
  userPostsPath?: string;
  userFansPath?: string;
  postsPerUser?: number;
  fetchVideoStats?: boolean;
}

export class TikHubDouyinClient extends TikHubXhsClient {
  private readonly userSearchPath: string;
  private readonly videoDetailPath: string;
  private readonly videoStatsPath: string;
  private readonly userProfilePath: string;
  private readonly userPostsPath: string;
  private readonly userFansPath: string;
  private readonly postsPerUser: number;
  private readonly fetchStats: boolean;

  constructor(options: TikHubDouyinClientOptions) {
    super(options);
    this.userSearchPath = options.userSearchPath ?? process.env.TIKHUB_DOUYIN_USER_SEARCH_PATH ?? DEFAULT_USER_SEARCH_PATH;
    this.videoDetailPath = options.videoDetailPath ?? process.env.TIKHUB_DOUYIN_VIDEO_DETAIL_PATH ?? DEFAULT_VIDEO_DETAIL_PATH;
    this.videoStatsPath = options.videoStatsPath ?? process.env.TIKHUB_DOUYIN_VIDEO_STATS_PATH ?? DEFAULT_VIDEO_STATS_PATH;
    this.userProfilePath = options.userProfilePath ?? process.env.TIKHUB_DOUYIN_USER_PROFILE_PATH ?? DEFAULT_USER_PROFILE_PATH;
    this.userPostsPath = options.userPostsPath ?? process.env.TIKHUB_DOUYIN_USER_POSTS_PATH ?? DEFAULT_USER_POSTS_PATH;
    this.userFansPath = options.userFansPath ?? process.env.TIKHUB_DOUYIN_USER_FANS_PATH ?? DEFAULT_USER_FANS_PATH;
    this.postsPerUser = Math.min(20, Math.max(1, options.postsPerUser ?? Number(process.env.TIKHUB_DOUYIN_POSTS_PER_USER ?? 5)));
    this.fetchStats = options.fetchVideoStats ?? String(process.env.TIKHUB_DOUYIN_FETCH_STATS ?? "true") === "true";
  }

  async searchUsers(keyword: string, cursor = 0, searchId = ""): Promise<JsonRecord> {
    const normalized = keyword.trim();
    if (!normalized) throw new Error("Douyin user search requires keyword");
    return this.postJson(this.userSearchPath, {
      keyword: normalized,
      cursor,
      douyin_user_fans: "",
      douyin_user_type: "",
      search_id: searchId,
    });
  }

  async getVideoDetail(awemeId: string): Promise<JsonRecord> {
    if (!awemeId.trim()) throw new Error("Douyin video detail requires aweme_id");
    return this.getJson(this.videoDetailPath, { aweme_id: awemeId });
  }

  async getVideoStatistics(awemeIds: string[]): Promise<JsonRecord> {
    const ids = awemeIds.filter(Boolean).slice(0, 2);
    if (!ids.length) throw new Error("Douyin video statistics requires aweme_ids");
    return this.getJson(this.videoStatsPath, { aweme_ids: ids.join(",") });
  }

  async getUserProfile(secUserId: string): Promise<JsonRecord> {
    if (!secUserId.trim()) throw new Error("Douyin user profile requires sec_user_id");
    return this.getJson(this.userProfilePath, { sec_user_id: secUserId });
  }

  async getUserPostedVideos(secUserId: string, maxCursor = 0): Promise<JsonRecord> {
    if (!secUserId.trim()) throw new Error("Douyin user posts requires sec_user_id");
    return this.getJson(this.userPostsPath, { sec_user_id: secUserId, max_cursor: maxCursor, count: this.postsPerUser, sort_type: 0, channel: "normal" });
  }


  async getUserFans(secUserId: string, maxCursor = 0): Promise<JsonRecord> {
    if (!secUserId.trim()) throw new Error("Douyin user fans requires sec_user_id");
    return this.getJson(this.userFansPath, { sec_user_id: secUserId, max_cursor: maxCursor, count: 20 });
  }
  async collectCreatorProfiles(keyword: string, targetCount: number): Promise<TikHubCollectResult> {
    const searchPayload = await this.searchUsers(keyword);
    const candidates = candidateItems(searchPayload).slice(0, Math.max(targetCount, 1));
    const profiles: TikHubCreatorProfile[] = [];
    for (const item of candidates) {
      const profile = profileFromItem(item);
      if (!profile) continue;
      try {
        const detail = await this.getUserProfile(profile.ref.platformCreatorId);
        mergeProfile(profile, detail);
      } catch {
        // Search result remains usable; detail failure is recorded as partial data.
      }
      try {
        const posted = await this.getUserPostedVideos(profile.ref.platformCreatorId);
        const videos = videoItems(posted).slice(0, this.postsPerUser);
        const statsById = new Map<string, JsonRecord>();
        if (this.fetchStats) {
          for (let offset = 0; offset < videos.length; offset += 2) {
            const ids = videos.slice(offset, offset + 2).map(videoId).filter((id): id is string => Boolean(id));
            if (!ids.length) continue;
            try {
              const stats = await this.getVideoStatistics(ids);
              for (const item of statisticItems(stats)) {
                const id = videoId(item);
                if (id) statsById.set(id, item);
              }
            } catch {
              // Statistics are enrichment only; text analysis continues.
            }
          }
        }
        for (const video of videos) {
          const caption = videoCaption(video);
          const id = videoId(video);
          const stats = id ? statsById.get(id) : undefined;
          profile.fields.posts.push({
            title: (caption ?? "抖音视频文案").slice(0, 100),
            interaction: interactionCount(stats ?? video),
          });
        }
        profile.fields.capturedAt = new Date().toISOString();
      } catch {
        // User profile result remains usable; no video media is downloaded.
      }
      profiles.push(profile);
      if (profiles.length >= targetCount) break;
    }
    const metrics = this.getMetrics();
    return { profiles, source: "douyin", pages: 1, requestCount: metrics.requestCount, retryCount: metrics.retryCount };
  }
}

export function createTikHubDouyinClient(env: Record<string, string | undefined>): TikHubDouyinClient {
  return new TikHubDouyinClient({
    token: env.TIKHUB_TOKEN ?? "",
    baseUrl: env.TIKHUB_BASE_URL,
    userSearchPath: env.TIKHUB_DOUYIN_USER_SEARCH_PATH,
    videoDetailPath: env.TIKHUB_DOUYIN_VIDEO_DETAIL_PATH,
    videoStatsPath: env.TIKHUB_DOUYIN_VIDEO_STATS_PATH,
    userProfilePath: env.TIKHUB_DOUYIN_USER_PROFILE_PATH,
    userPostsPath: env.TIKHUB_DOUYIN_USER_POSTS_PATH,
    userFansPath: env.TIKHUB_DOUYIN_USER_FANS_PATH,
    postsPerUser: Number(env.TIKHUB_DOUYIN_POSTS_PER_USER ?? 5),
    fetchVideoStats: env.TIKHUB_DOUYIN_FETCH_STATS ? env.TIKHUB_DOUYIN_FETCH_STATS === "true" : undefined,
  });
}
