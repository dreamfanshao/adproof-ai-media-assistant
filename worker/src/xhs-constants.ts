// T07 Phase 1｜小红书采集常量：URL、选择器、风控/失败分类、限速参数
// 选择器基线来自 2026-08-18 真实会话 DOM 诊断（T07 工作产出/搜索页与达人主页DOM字段映射证据.md）

export const XHS_ORIGIN = "https://www.xiaohongshu.com";
export const XHS_EXPLORE_URL = `${XHS_ORIGIN}/explore`;
export const SEARCH_SOURCE = "web_explore_feed";

export const LOGIN_COOKIE_NAMES = new Set(["web_session"]);

/** 平台风控/验证文案（出现即停止自动读取） */
export const RESTRICTED_PATTERN = /验证码|安全验证|访问异常|网络环境存在风险/;

/** 搜索页选择器 */
export const SEARCH_SELECTORS = {
  /** 达人作者链接：a.author + /user/profile/ 路径（自动排除"我"卡片等非 author 链接） */
  creatorLink: 'a.author[href*="/user/profile/"]',
  /** 结果卡片容器 */
  card: ".note-item",
  /** 我的卡片防护文本（兜底） */
  selfCardText: /^我{1,2}$/,
} as const;

/** 达人主页选择器 */
export const PROFILE_SELECTORS = {
  nickname: ".user-nickname, .user-name",
  /** 指标行：文本形如 "193粉丝" / "3314获赞与收藏" / "62关注" */
  metrics: ".shows",
  /** 头像（首张，非页脚 logo） */
  avatar: 'img[src*="sns-avatar-qc.xhscdn.com/avatar/"]',
} as const;

/** 字段缺失警告码（写入 field_warnings / evidence） */
export const FIELD_WARNING = {
  NICKNAME_MISSING: "NICKNAME_MISSING",
  FOLLOWERS_MISSING: "FOLLOWERS_MISSING",
  LIKES_MISSING: "LIKES_COLLECTED_MISSING",
  HANDLE_MISSING: "HANDLE_MISSING",
  BIO_MISSING: "BIO_MISSING",
  AVATAR_MISSING: "AVATAR_MISSING",
  PROFILE_RESTRICTED: "PROFILE_RESTRICTED",
  PROFILE_TIMEOUT: "PROFILE_TIMEOUT",
  PROFILE_PARSE_FAILED: "PROFILE_PARSE_FAILED",
  SEARCH_RESTRICTED: "SEARCH_RESTRICTED",
  SEARCH_EMPTY: "SEARCH_EMPTY",
} as const;
export type FieldWarningCode = (typeof FIELD_WARNING)[keyof typeof FIELD_WARNING];

/** 限速与等待（保守，避免触发风控） */
export const RATE_LIMIT = {
  /** 主页串行访问间隔 */
  profileIntervalMs: 2_000,
  /** 搜索页滚动间隔 */
  scrollDelayMs: 800,
  /** 搜索页加载后等待 */
  searchSettleMs: 4_000,
  /** 主页内容等待上限 */
  profileWaitMs: 15_000,
  /** 主页打开后额外等待 */
  profileSettleMs: 1_500,
  /** 单页收集上限（翻页前） */
  pageScrolls: 5,
} as const;
