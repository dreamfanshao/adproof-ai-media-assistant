// T07 Phase 1 临时集成测试：真实会话 → 搜索收集 → 主页字段映射（验证后删除）
// 只输出脱敏证据，不输出 Cookie/Token/完整账号标识
import { readFileSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseXhsSessionRepository,
  XhsSessionCipher,
} from "../../../server/src/services/xhs-session-persistence.js";
import { extractProfileFields, extractSearchCreatorRefs, isRestrictedPage } from "../xhs-field-mapper.js";
import { RATE_LIMIT, SEARCH_SOURCE, XHS_ORIGIN } from "../xhs-constants.js";

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv();
const repository = createSupabaseXhsSessionRepository(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const cipher = new XhsSessionCipher(env.XHS_SESSION_ENCRYPTION_KEY);

const browser = await chromium.launch({
  channel: "msedge",
  headless: false,
  args: ["--start-minimized", "--window-position=-32000,-32000", "--window-size=1440,960", "--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check", "--disable-infobars"],
});
try {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: rows } = await client.from("platform_sessions").select("user_id,status").eq("status", "connected");
  const row = rows?.[0];
  if (!row) throw new Error("no connected session");
  const stored = await repository.load(row.user_id);
  if (!stored?.encryptedState) throw new Error("no encrypted state");
  const storageState = cipher.decrypt(stored.encryptedState) as Awaited<ReturnType<BrowserContext["storageState"]>>;

  const context = await browser.newContext({ locale: "zh-CN", timezoneId: "Asia/Shanghai", viewport: { width: 1440, height: 960 }, storageState });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();

  // 1. 搜索收集
  const searchUrl = new URL("/search_result", XHS_ORIGIN);
  searchUrl.searchParams.set("keyword", "光子嫩肤");
  searchUrl.searchParams.set("source", SEARCH_SOURCE);
  await page.goto(searchUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(RATE_LIMIT.searchSettleMs);
  if (await isRestrictedPage(page)) throw new Error("SEARCH_RESTRICTED");
  const refs = await extractSearchCreatorRefs(page);
  console.log(`COLLECT refs=${refs.length} sample=${refs.slice(0, 3).map((r) => `${r.platformCreatorId.slice(0, 4)}…`).join(",")}`);

  // 2. 前 2 个主页字段映射（串行限速）
  for (const ref of refs.slice(0, 2)) {
    await page.waitForTimeout(RATE_LIMIT.profileIntervalMs);
    await page.goto(ref.profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(RATE_LIMIT.profileSettleMs);
    if (await isRestrictedPage(page)) {
      console.log(`PROFILE ${ref.platformCreatorId.slice(0, 4)}… restricted`);
      continue;
    }
    try {
      await page.waitForSelector(".user-nickname, .user-name", { timeout: RATE_LIMIT.profileWaitMs });
    } catch { /* 字段缺失由 extractProfileFields 记警告 */ }
    const fields = await extractProfileFields(page);
    console.log(`PROFILE ${ref.platformCreatorId.slice(0, 4)}… => ${JSON.stringify({
      nickname: fields.nickname,
      followers: fields.followers,
      following: fields.following,
      likesCollected: fields.likesCollected,
      handle: fields.handle,
      ipLocation: fields.ipLocation,
      bio: fields.bio ? fields.bio.slice(0, 60) : null,
      avatar: fields.avatarUrl ? "yes" : "no",
      posts: fields.posts.length,
      warnings: fields.warnings,
      completeness: fields.dataCompleteness,
    }, null, 2)}`);
  }
} finally {
  await browser.close().catch(() => undefined);
}
