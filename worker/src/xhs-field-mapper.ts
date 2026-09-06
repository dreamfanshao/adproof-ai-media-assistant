// T07 Phase 1｜小红书字段映射：搜索页达人引用收集 + 达人主页字段提取
// 只读取公开页面数据；输出结构为纯数据（不含 Cookie/Token/完整账号标识），脱敏由调用方负责
import type { Page } from "playwright";
import { FIELD_WARNING, PROFILE_SELECTORS, RESTRICTED_PATTERN, SEARCH_SELECTORS, XHS_ORIGIN } from "./xhs-constants.js";
import type { FieldWarningCode } from "./xhs-constants.js";

/** 搜索页收集到的达人引用（主页 URL + 平台达人 ID） */
export interface SearchCreatorRef {
  platformCreatorId: string;
  profileUrl: string;
  /** 卡片文本中的作者名（best-effort，权威值以主页为准） */
  cardNickname: string | null;
}

/** 达人主页 MVP 字段快照 */
export interface CreatorProfileFields {
  nickname: string | null;
  /** 小红书号 */
  handle: string | null;
  ipLocation: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  /** 获赞与收藏 */
  likesCollected: number | null;
  avatarUrl: string | null;
  /** 首屏笔记（标题 + 互动数），供后续语义匹配输入 */
  posts: Array<{ title: string; likes?: number | null; interaction: number | null; imageUrls?: string[]; publishedAt?: string }>;
  imageUrls: string[];
  capturedAt: string;
  warnings: FieldWarningCode[];
  dataCompleteness: "complete" | "partial";
}

/** 解析形如 "193粉丝"、"3314获赞与收藏"、"1.2万粉丝" 的指标文本 */
export function parseCountLabel(text: string): { label: "粉丝" | "关注" | "获赞与收藏"; value: number } | null {
  const match = text.replace(/\s+/g, "").match(/^([\d.]+)\s*([wW万])?\s*(关注|粉丝|获赞与收藏)$/);
  if (!match) return null;
  let value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2]) value *= match[2].toLowerCase() === "w" || match[2] === "万" ? 10_000 : 1;
  const label = match[3] as "关注" | "粉丝" | "获赞与收藏";
  return { label, value: Math.round(value) };
}

/** 从搜索页提取达人引用（按 href 去重；a.author 选择器已排除"我"卡片，仍做文本兜底） */
export async function extractSearchCreatorRefs(page: Page): Promise<SearchCreatorRef[]> {
  return page.locator(SEARCH_SELECTORS.creatorLink).evaluateAll((links, origin) => {
    const seen = new Set<string>();
    const out: SearchCreatorRef[] = [];
    for (const link of links) {
      const href = link.getAttribute("href") ?? "";
      const platformCreatorId = href.split("/").filter(Boolean).pop() ?? "";
      if (!platformCreatorId || seen.has(platformCreatorId)) continue;
      let card: Element | null = link;
      for (let i = 0; i < 4 && card; i += 1) card = card.parentElement;
      const cardText = (card?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (/^我{1,2}$/.test(cardText)) continue;
      seen.add(platformCreatorId);
      out.push({
        platformCreatorId,
        profileUrl: href.startsWith("http") ? href : `${origin}${href}`,
        cardNickname: null,
      });
    }
    return out;
  }, XHS_ORIGIN);
}

/** 已知的小红书默认/占位头像（需排除，避免抓错） */
const DEFAULT_AVATAR_HASHES = new Set(["645b800677c97ef1a2abc7e0"]);

function normalizeAvatarSrc(src: string | null | undefined): string | null {
  if (!src) return null;
  const clean = src.startsWith("//") ? `https:${src}` : src;
  const hash = clean.split("/").pop()?.split("?")[0]?.split(".")[0];
  if (hash && DEFAULT_AVATAR_HASHES.has(hash)) return null;
  return clean;
}

/**
 * 抓取主页主人的头像：
 * 1) 从昵称元素向上找用户信息区内的头像（精准，避免抓到登录用户自己的头部头像）；
 * 2) 兜底取页面中尺寸最大的非默认头像。
 */
export async function scrapeProfileAvatar(page: Page): Promise<string | null> {
  const scoped = await page
    .locator(PROFILE_SELECTORS.nickname)
    .first()
    .evaluate((el) => {
      let node: Element | null = el;
      for (let i = 0; i < 6 && node; i += 1) {
        const img = node.querySelector('img[src*="xhscdn.com/avatar/"], img[src*="avatar"]');
        if (img) return img.getAttribute("src");
        node = node.parentElement;
      }
      return null;
    })
    .catch(() => null);
  const scopedClean = normalizeAvatarSrc(scoped);
  if (scopedClean) return scopedClean;

  const largest = await page
    .locator('img[src*="xhscdn.com/avatar/"]')
    .evaluateAll((imgs) => {
      let best: string | null = null;
      let bestSize = 0;
      for (const img of imgs) {
        const rect = img.getBoundingClientRect();
        const size = rect.width * rect.height;
        if (size > bestSize) {
          bestSize = size;
          best = img.getAttribute("src");
        }
      }
      return best;
    })
    .catch(() => null);
  return normalizeAvatarSrc(largest);
}

/** 提取主页公开字段（best-effort；缺字段记警告，dataCompleteness=partial） */
export async function extractProfileFields(page: Page): Promise<CreatorProfileFields> {
  const warnings: FieldWarningCode[] = [];
  const capturedAt = new Date().toISOString();

  const nickname = (await page.locator(PROFILE_SELECTORS.nickname).first().textContent().catch(() => null))?.trim() || null;
  if (!nickname) warnings.push(FIELD_WARNING.NICKNAME_MISSING);

  let followers: number | null = null;
  let following: number | null = null;
  let likesCollected: number | null = null;
  // .shows 元素自身只含标签文本（"粉丝"），计数+标签拼接文本在父元素上（"193粉丝"）
  const showsTexts = await page.locator(PROFILE_SELECTORS.metrics).evaluateAll((nodes) =>
    nodes.map((n) => (n.parentElement?.textContent ?? n.textContent ?? "").trim()),
  );
  for (const raw of showsTexts) {
    const parsed = parseCountLabel(raw.trim());
    if (!parsed) continue;
    if (parsed.label === "粉丝") followers = parsed.value;
    else if (parsed.label === "关注") following = parsed.value;
    else if (parsed.label === "获赞与收藏") likesCollected = parsed.value;
  }
  if (followers === null) warnings.push(FIELD_WARNING.FOLLOWERS_MISSING);
  if (likesCollected === null) warnings.push(FIELD_WARNING.LIKES_MISSING);

  const avatarUrl = await scrapeProfileAvatar(page);
  if (!avatarUrl) warnings.push(FIELD_WARNING.AVATAR_MISSING);

  // 文本块：小红书号 / IP属地 / 简介 / 首屏笔记（按行解析）
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lines = bodyText.split("\n").map((line) => line.trim()).filter(Boolean);
  const handle = lines.find((line) => /^小红书号[:：]/.test(line))?.replace(/^小红书号[:：]\s*/, "") ?? null;
  if (!handle) warnings.push(FIELD_WARNING.HANDLE_MISSING);
  const ipLocation = lines.find((line) => /^IP属地[:：]/.test(line))?.replace(/^IP属地[:：]\s*/, "") ?? null;

  // 简介：IP属地行之后、第一个纯数字（指标计数）行之前的连续文本
  const ipIndex = lines.findIndex((line) => /^IP属地[:：]/.test(line));
  let bio: string | null = null;
  if (ipIndex >= 0) {
    const bioLines: string[] = [];
    for (let i = ipIndex + 1; i < lines.length; i += 1) {
      if (/^\d+$/.test(lines[i])) break;
      bioLines.push(lines[i]);
    }
    bio = bioLines.join(" ").slice(0, 500) || null;
  }
  if (!bio) warnings.push(FIELD_WARNING.BIO_MISSING);

  // 首屏笔记：指标块之后的标题行（跳过作者昵称重复行与纯数字行）
  const posts: Array<{ title: string; interaction: number | null; publishedAt?: string }> = [];
  const noteMarkerIndex = lines.findIndex((line) => line === "笔记");
  if (noteMarkerIndex >= 0) {
    for (let i = noteMarkerIndex + 1; i < lines.length && posts.length < 12; i += 1) {
      const line = lines[i];
      if (!line || line === "收藏" || /^\d+$/.test(line) || (nickname && line === nickname)) continue;
      const next = lines[i + 1] ?? "";
      const interaction = /^\d+$/.test(next) ? Number.parseInt(next, 10) : null;
      posts.push({ title: line.slice(0, 100), interaction });
      if (interaction !== null) i += 1;
    }
  }

  const imageUrls = Array.from(new Set(await page.locator('img[src]').evaluateAll((imgs) => imgs
    .map((img) => img.getAttribute('src') || "")
    .map((src) => src.startsWith("//") ? "https:" + src : src)
    .filter((src) => /^https?:\/\//i.test(src) && /xhscdn\.com/i.test(src))
    .slice(0, 24))));

  const dataCompleteness: "complete" | "partial" = warnings.length === 0 ? "complete" : "partial";
  return {
    nickname,
    handle,
    ipLocation,
    bio,
    followers,
    following,
    likesCollected,
    avatarUrl,
    posts,
    imageUrls,
    capturedAt,
    warnings,
    dataCompleteness,
  };
}

/** 页面是否触发平台风控文案 */
export async function isRestrictedPage(page: Page): Promise<boolean> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return RESTRICTED_PATTERN.test(bodyText);
}
