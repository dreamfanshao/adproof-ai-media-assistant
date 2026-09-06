import { chromium, type BrowserContext, type Page } from "playwright";

const XHS_HOME_URL = "https://www.xiaohongshu.com/explore";
const MAX_WAIT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 1_000;
const LOGIN_COOKIE_NAMES = new Set(["web_session"]);

type LoginProbe = {
  authenticated: boolean;
  evidence: string[];
};

async function inspectLogin(context: BrowserContext, page: Page): Promise<LoginProbe> {
  const cookies = await context.cookies("https://www.xiaohongshu.com");
  const evidence: string[] = [];

  if (cookies.some((cookie) => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value.length > 0)) {
    evidence.push("检测到已登录会话标记（未读取或输出标记值）");
  }

  const loginButtonVisible = await page
    .getByText("登录", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);

  if (!loginButtonVisible) {
    evidence.push("页面未显示登录入口");
  }

  return {
    authenticated: evidence.length === 2,
    evidence,
  };
}

async function ensureLoginPanel(page: Page): Promise<void> {
  const qrRelatedNodeCount = await page
    .locator('canvas, img[alt*="二维码"], img[src^="data:image"]')
    .count();

  if (qrRelatedNodeCount > 0) {
    return;
  }

  const loginButton = page.getByText("登录", { exact: true }).first();
  if (await loginButton.isVisible().catch(() => false)) {
    await loginButton.click();
  }
}

async function runLoginOnly(): Promise<void> {
  console.log("[XHS PoC] 正在启动临时 Edge 会话……");
  console.log("[XHS PoC] 不会把 Cookie、二维码或账号信息写入磁盘/日志。");

  const browser = await chromium.launch({
    channel: "msedge",
    headless: false,
  });

  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  const shutdown = async () => {
    await browser.close().catch(() => undefined);
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await page.goto(XHS_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await ensureLoginPanel(page);

    const qrCandidateCount = await page
      .locator('canvas, img[alt*="二维码"], img[src^="data:image"]')
      .count();

    console.log(`[XHS PoC] 已打开官方页面：${new URL(page.url()).origin}`);
    console.log(`[XHS PoC] 二维码候选节点：${qrCandidateCount}`);
    console.log("[XHS PoC] 请在打开的 Edge 窗口中使用小红书 App 扫码；若出现验证码或风控，请手动处理，不会自动绕过。");

    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      if (page.isClosed()) {
        throw new Error("浏览器页面已被关闭");
      }

      const probe = await inspectLogin(context, page);
      if (probe.authenticated) {
        console.log(`[XHS PoC] 登录状态确认成功：${probe.evidence.join("；")}`);
        console.log("[XHS PoC] 浏览器将保留 30 秒，用于下一步真实页面读取检查。");
        await page.waitForTimeout(30_000);
        return;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    throw new Error("等待扫码登录超时（10 分钟）");
  } finally {
    await shutdown();
  }
}

async function verifySearchAndCreator(page: Page): Promise<void> {
  const keyword = "光子嫩肤";
  const searchUrl = new URL("/search_result", XHS_HOME_URL);
  searchUrl.searchParams.set("keyword", keyword);
  searchUrl.searchParams.set("source", "web_explore_feed");

  const searchResponse = await page.goto(searchUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5_000);

  const searchBody = await page.locator("body").innerText().catch(() => "");
  if (/验证码|安全验证|访问异常|网络环境存在风险/.test(searchBody)) {
    throw new Error("搜索页触发平台验证或风控，已停止自动读取");
  }

  const resultLinkCount = await page
    .locator('a[href*="/explore/"], a[href*="/discovery/item/"]')
    .count();

  const creatorHrefs = await page.locator('a[href*="/user/profile/"]').evaluateAll((links) =>
    Array.from(
      new Set(
        links
          .map((link) => link.getAttribute("href"))
          .filter((href): href is string => Boolean(href)),
      ),
    ),
  );

  if (resultLinkCount === 0 || creatorHrefs.length === 0) {
    throw new Error(
      `搜索页未识别到可读结果（内容链接 ${resultLinkCount}，达人链接 ${creatorHrefs.length}）`,
    );
  }

  console.log(
    `[XHS PoC] 搜索页读取成功：HTTP ${searchResponse?.status() ?? "unknown"}，内容链接 ${resultLinkCount}，达人链接 ${creatorHrefs.length}`,
  );

  const creatorUrl = new URL(creatorHrefs[0], XHS_HOME_URL);
  if (creatorUrl.origin !== new URL(XHS_HOME_URL).origin || !creatorUrl.pathname.startsWith("/user/profile/")) {
    throw new Error("达人主页链接不属于小红书官方域名");
  }

  const creatorResponse = await page.goto(creatorUrl.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5_000);

  const creatorBody = await page.locator("body").innerText().catch(() => "");
  if (/验证码|安全验证|访问异常|网络环境存在风险/.test(creatorBody)) {
    throw new Error("达人主页触发平台验证或风控，已停止自动读取");
  }

  const publicMetricMarkerCount = await page.getByText(/粉丝|获赞与收藏/).count();
  const publicContentLinkCount = await page
    .locator('a[href*="/explore/"], a[href*="/discovery/item/"]')
    .count();

  if (publicMetricMarkerCount === 0 && publicContentLinkCount === 0) {
    throw new Error("达人主页已打开，但未识别到公开指标或公开内容");
  }

  console.log(
    `[XHS PoC] 达人主页读取成功：HTTP ${creatorResponse?.status() ?? "unknown"}，公开指标标记 ${publicMetricMarkerCount}，公开内容链接 ${publicContentLinkCount}`,
  );
  console.log("[XHS PoC] 全链路通过；未输出达人身份、账号、Cookie 或内容详情。");
}

async function run(): Promise<void> {
  console.log("[XHS PoC] 正在启动临时 Edge 会话……");
  console.log("[XHS PoC] 不会把 Cookie、二维码、账号或达人身份信息写入磁盘/日志。");

  const browser = await chromium.launch({
    channel: "msedge",
    headless: false,
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();

  try {
    await page.goto(XHS_HOME_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await ensureLoginPanel(page);

    const qrCandidateCount = await page
      .locator('canvas, img[alt*="二维码"], img[src^="data:image"]')
      .count();
    console.log(`[XHS PoC] 已打开官方页面：${new URL(page.url()).origin}`);
    console.log(`[XHS PoC] 二维码候选节点：${qrCandidateCount}`);
    console.log("[XHS PoC] 请扫码并在手机端确认；如出现验证码或风控，只允许手动处理。");

    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_WAIT_MS) {
      if (page.isClosed()) {
        throw new Error("浏览器页面已被关闭");
      }

      const probe = await inspectLogin(context, page);
      if (probe.authenticated) {
        console.log(`[XHS PoC] 登录状态确认成功：${probe.evidence.join("；")}`);
        await verifySearchAndCreator(page);
        await page.waitForTimeout(10_000);
        return;
      }

      await page.waitForTimeout(POLL_INTERVAL_MS);
    }

    throw new Error("等待扫码登录超时（10 分钟）");
  } finally {
    await browser.close().catch(() => undefined);
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[XHS PoC] 失败：${message}`);
  process.exitCode = 1;
});
