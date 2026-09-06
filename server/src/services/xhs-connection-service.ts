import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type {
  EncryptedSessionState,
  XhsSessionCipher,
  XhsSessionRepository,
} from "./xhs-session-persistence.js";

const execFileAsync = promisify(execFile);

const XHS_HOME_URL = "https://www.xiaohongshu.com/explore";
const XHS_LOGIN_URL = "https://www.xiaohongshu.com/login";
const QR_TTL_MS = 2 * 60 * 1000;
const RESTRICTED_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 800;
const LOGIN_COOKIE_NAMES = new Set(["web_session"]);
// 小红书登录弹层的二维码实现会随版本变化：有时是 canvas/data:image，有时是
// 带 qrcode 类名的 CSS/SVG 容器。把这些形态统一纳入，避免只认 canvas 导致“连接失败”。
// Prefer real image nodes before QR containers to avoid blank placeholders.
const QR_SELECTOR = [
  'canvas',
  'img[alt*="二维码"]',
  'img[src^="data:image"]',
  'img',
  'svg',
  '[class*="qrcode"]',
  '[class*="qr-code"]',
  '[class*="qr_code"]',
  '[class*="QRCode"]',
  '[id*="qrcode"]',
  '[id*="qr-code"]',
  '[style*="background-image"]',
].join(', ');
const MIN_QR_SIZE_PX = 80;
const RESTRICTED_PATTERN = /验证码|安全验证|访问异常|网络环境存在风险/;
const SCANNED_PATTERN = /扫码成功|已扫码|请在手机上确认|请在手机端确认/;
// 反自动化特征：降低被平台风控识别为“机器人”的概率，减少安全验证弹窗。
// 必须保持有头模式（headless 会被小红书风控直接拦截，见 300012）；窗口启动即最小化并离屏定位，保证用户屏幕上看不到受控浏览器。
const LAUNCH_ARGS = [
  "--start-minimized",
  "--window-position=-32000,-32000",
  "--window-size=1440,960",
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
];

// 启动前监控：受控 Edge 窗口创建的一瞬间即 SW_HIDE（Playwright 临时配置目录名可安全区分用户浏览器）。
const HIDE_NEW_PLAYWRIGHT_WINDOWS_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W32Watch{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);}';
$start=Get-Date; $deadline=$start.AddSeconds(45);
while((Get-Date)-lt $deadline){
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CreationDate -ge $start -and $_.CommandLine -match 'playwright_chromiumdev_profile' } | ForEach-Object {
    $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
    if($p -and $p.MainWindowHandle -ne 0){ [W32Watch]::ShowWindow($p.MainWindowHandle,0) | Out-Null }
  }
  Start-Sleep -Milliseconds 150
}
`;

function watchAndHideNewBrowserWindows(): void {
  if (process.platform !== "win32") return;
  execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", HIDE_NEW_PLAYWRIGHT_WINDOWS_SCRIPT], {
    windowsHide: true,
    timeout: 60_000,
  }).catch(() => undefined);
}

async function launchBrowser(): Promise<Browser> {
  // 先启动隐藏监控，再启动浏览器，保证窗口一旦创建即被隐藏（不闪现在屏幕或任务栏）
  watchAndHideNewBrowserWindows();
  return chromium.launch({ channel: "msedge", headless: false, args: LAUNCH_ARGS });
}

// 受控 Edge 窗口对用户彻底不可见：即使最小化+离屏，任务栏仍会出现按钮并闪烁。
// 通过 user32 ShowWindow(SW_HIDE=0 / SW_SHOW=5) 隐藏/显示整个窗口，连任务栏按钮都不出现。
// 窗口只在用户主动点击"打开验证窗口"时才临时显示。
const SET_BROWSER_WINDOW_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W32Win{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);}';
$deadline=(Get-Date).AddSeconds(10); $done=$false;
while((Get-Date)-lt $deadline -and -not $done){
  $p=Get-Process -Id $env:WINDOW_PID -ErrorAction SilentlyContinue;
  if($p -and $p.MainWindowHandle -ne 0){ [W32Win]::ShowWindow($p.MainWindowHandle,[int]$env:SW_ACTION) | Out-Null; $done=$true }
  else { Start-Sleep -Milliseconds 200 }
}
`;

async function setBrowserWindowOnDesktop(browserPid: number, visible: boolean): Promise<void> {
  if (process.platform !== "win32" || !Number.isInteger(browserPid)) return;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SET_BROWSER_WINDOW_SCRIPT], {
      env: { ...process.env, WINDOW_PID: String(browserPid), SW_ACTION: visible ? "5" : "0" },
      windowsHide: true,
      timeout: 12_000,
    });
  } catch {
    // 窗口显隐是体验优化，失败不阻断连接逻辑
  }
}

// 通过浏览器级 CDP 会话获取浏览器主进程的 OS PID（SystemInfo.getProcessInfo 的 id 即操作系统进程号），
// 用于对受控 Edge 主窗口执行 ShowWindow 隐藏/显示。
async function getBrowserProcessId(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    try {
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      const browserProcess = processInfo?.find((entry: { type?: string }) => entry.type === "browser");
      return browserProcess?.id ?? null;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

async function hideBrowserWindowSoon(browser: Browser): Promise<void> {
  const pid = await getBrowserProcessId(browser);
  if (pid) void setBrowserWindowOnDesktop(pid, false);
}

async function prepareContext(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

async function hasVisibleQr(page: Page): Promise<boolean> {
  const candidates = page.locator(QR_SELECTOR);
  const count = await candidates.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox().catch(() => null);
    if (!box || box.width < MIN_QR_SIZE_PX || box.height < MIN_QR_SIZE_PX) continue;
    const looksLikeQr = await candidate.evaluate((element) => {
      const tag = element.tagName.toLowerCase();
      const hint = `${element.id} ${typeof element.className === "string" ? element.className : ""} ${(element as HTMLElement).getAttribute("alt") ?? ""}`;
      let context = "";
      let contextNode: Element | null = element;
      for (let depth = 0; depth < 6 && contextNode; depth += 1, contextNode = contextNode.parentElement) {
        context += ` ${(contextNode as HTMLElement).innerText ?? ""}`;
      }
      context = context.slice(0, 1200);
      const inLoginContext = /扫码|二维码|登录后推荐|小红书如何扫码/i.test(context);
      if (/qr|code|二维码/i.test(hint)) return true;
      if (tag === "canvas") return true;
      if (tag === "svg") {
        const rect = element.getBoundingClientRect();
        return /qr|code|二维码/i.test(hint) && rect.width >= 120 && rect.height >= 120;
      }
      if (tag === "img") {
        const image = element as HTMLImageElement;
        const rect = element.getBoundingClientRect();
        const ratio = image.naturalWidth > 0 && image.naturalHeight > 0
          ? image.naturalWidth / image.naturalHeight
          : rect.width / Math.max(1, rect.height);
        return inLoginContext && ratio > 0.65 && ratio < 1.45 && image.complete && image.naturalWidth >= 80;
      }
      return Boolean(element.querySelector("canvas, img, svg")) && inLoginContext;
    }).catch(() => false);
    if (looksLikeQr) return true;
  }
  return false;
}

async function isRestrictedPage(page: Page): Promise<boolean> {
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (!RESTRICTED_PATTERN.test(bodyText)) return false;
  // 二维码可见时不算受限（登录面板上可能出现无关的“安全验证”字样）
  return !(await hasVisibleQr(page));
}

export type PlatformConnectionStatus =
  | "disconnected"
  | "qr_pending"
  | "qr_scanned"
  | "connected"
  | "expired"
  | "restricted"
  | "failed";

export interface PlatformConnection {
  id: string | null;
  task_id: string | null;
  platform: "xiaohongshu";
  status: PlatformConnectionStatus;
  qr_image_url: string | null;
  qr_expires_at: string | null;
  session_expires_at: string | null;
  last_verified_at: string | null;
  account_display_name: string | null;
  account_handle_masked: string | null;
  avatar_url: string | null;
  message_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface XhsConnectionService {
  create(userId: string): Promise<PlatformConnection>;
  get(userId: string): Promise<PlatformConnection>;
  showVerificationWindow(userId: string): Promise<PlatformConnection>;
  disconnect(userId: string): Promise<void>;
  closeAll(): Promise<void>;
}

interface LiveSession {
  connection: PlatformConnection;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  stopped: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function disconnectedConnection(): PlatformConnection {
  const now = nowIso();
  return {
    id: null,
    task_id: null,
    platform: "xiaohongshu",
    status: "disconnected",
    qr_image_url: null,
    qr_expires_at: null,
    session_expires_at: null,
    last_verified_at: null,
    account_display_name: null,
    account_handle_masked: null,
    avatar_url: null,
    message_code: null,
    created_at: now,
    updated_at: now,
  };
}

function publicConnection(connection: PlatformConnection): PlatformConnection {
  return { ...connection };
}

async function waitForQr(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await hasVisibleQr(page)) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

// 从登录后的页面抓取当前小红书用户头像 URL（公开 CDN 图片地址，非凭据）。
// 注意：登录用户本人的头像可能本身就是小红书默认头像（如"小红薯+数字"账号），
// 因此这里不排除默认头像——优先取顶部"我"导航的头像（=本人），兜底访问本人主页抓取。
function normalizeAvatarSrc(src: string | null | undefined): string | null {
  if (!src || src.length < 10) return null;
  return src.startsWith("//") ? `https:${src}` : src;
}

async function scrapeAvatarUrl(page: Page): Promise<string | null> {
  // 1) 顶部"我"导航链接里的头像（登录用户本人；可能是默认头像，也算正确）
  const meAvatar = await page
    .getByText("我", { exact: true })
    .first()
    .evaluate((el) => {
      let node: Element | null = el;
      for (let i = 0; i < 5 && node; i += 1) {
        const img = node.querySelector('img[src*="xhscdn.com/avatar/"]');
        if (img) return img.getAttribute("src");
        node = node.parentElement;
      }
      return null;
    })
    .catch(() => null);
  const meAvatarClean = normalizeAvatarSrc(meAvatar);
  if (meAvatarClean) return meAvatarClean;

  // 2) 兜底：打开登录用户自己的主页，取用户信息区头像
  const meHref = await page
    .getByText("我", { exact: true })
    .first()
    .evaluate((el) => {
      let node: Element | null = el;
      for (let i = 0; i < 4 && node; i += 1) {
        const href = node.getAttribute?.("href");
        if (href) return href;
        node = node.parentElement;
      }
      return null;
    })
    .catch(() => null);
  if (meHref) {
    try {
      await page.goto(new URL(meHref, XHS_HOME_URL).toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector(".user-nickname, .user-name", { timeout: 10_000 }).catch(() => undefined);
      const scoped = await page
        .locator(".user-nickname, .user-name")
        .first()
        .evaluate((el) => {
          let node: Element | null = el;
          for (let i = 0; i < 6 && node; i += 1) {
            const img = node.querySelector('img[src*="xhscdn.com/avatar/"]');
            if (img) return img.getAttribute("src");
            node = node.parentElement;
          }
          return null;
        })
        .catch(() => null);
      const scopedClean = normalizeAvatarSrc(scoped);
      if (scopedClean) return scopedClean;
    } catch {
      // 兜底失败则返回 null，前端回退默认图标
    }
  }
  return null;
}

async function openLoginPanel(page: Page): Promise<void> {
  // 页面可能已自动弹出登录面板（二维码加载需要时间），先短暂等待；无则尽快进入点击流程
  if (await waitForQr(page, 1_000)) return;

  // 先 Esc 关闭可能遮挡点击的弹窗遮罩（如新人引导、登录弹层背板）
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(300);

  const loginButtons = page.getByText("登录", { exact: true });
  for (let index = 0; index < await loginButtons.count(); index += 1) {
    const loginButton = loginButtons.nth(index);
    if (await loginButton.isVisible().catch(() => false)) {
      await loginButton.click().catch(() => undefined);
      if (await waitForQr(page, 3_000)) return;
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(200);
    }
  }

  // 搜索框占位符"登录探索更多内容"路径：输入+回车触发登录面板，被遮罩拦截则 Esc 后重试
  const loginSearchPrompt = page.getByPlaceholder(/登录.*探索|登录/).first();
  if (await loginSearchPrompt.isVisible().catch(() => false)) {
    await loginSearchPrompt.fill("光子嫩肤").catch(() => undefined);
    await loginSearchPrompt.press("Enter").catch(() => undefined);
    if (await waitForQr(page, 3_000)) return;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const inputBox = loginSearchPrompt.locator("xpath=..");
      const searchTrigger = inputBox.locator("button, [role='button'], svg").last();
      if (await searchTrigger.isVisible().catch(() => false)) {
        await searchTrigger.click({ timeout: 2_000 }).catch(() => undefined);
      } else {
        const box = await inputBox.boundingBox();
        if (box) await inputBox.click({ position: { x: box.width - 24, y: box.height / 2 } }).catch(() => undefined);
      }
      if (await waitForQr(page, 2_000)) return;
      await page.keyboard.press("Escape").catch(() => undefined);
      await page.waitForTimeout(400);
    }
  }
}

type LoginPanelState = "qr" | "restricted" | "unavailable";

async function dismissPlatformNotice(page: Page): Promise<void> {
  for (const text of ["我知道了", "关闭", "跳过"]) {
    const buttons = page.getByText(text, { exact: true });
    for (let index = 0; index < await buttons.count(); index += 1) {
      const button = buttons.nth(index);
      if (await button.isVisible().catch(() => false)) await button.click().catch(() => undefined);
    }
  }
  await page.keyboard.press("Escape").catch(() => undefined);
}

// 小红书登录入口经常改版：先尝试当前页面，再直接访问官方登录页，始终在同一个隐藏页面内完成。
async function openLoginPanelStable(page: Page): Promise<LoginPanelState> {
  await dismissPlatformNotice(page);
  if (await isRestrictedPage(page)) return "restricted";
  if (await waitForQr(page, 700)) return "qr";

  const loginSearchPrompt = page.getByPlaceholder(/登录.*探索|登录/).first();
  if (await loginSearchPrompt.isVisible().catch(() => false)) {
    await loginSearchPrompt.fill("光子嫩肤").catch(() => undefined);
    await loginSearchPrompt.press("Enter").catch(() => undefined);
    if (await waitForQr(page, 2_000)) return "qr";
    await dismissPlatformNotice(page);
    const inputBox = loginSearchPrompt.locator("xpath=..");
    const searchTrigger = inputBox.locator("button, [role='button'], svg, .input-button").last();
    if (await searchTrigger.isVisible().catch(() => false)) {
      await searchTrigger.click({ timeout: 1_500 }).catch(() => undefined);
    } else {
      const box = await inputBox.boundingBox().catch(() => null);
      if (box) await inputBox.click({ position: { x: Math.max(1, box.width - 24), y: box.height / 2 } }).catch(() => undefined);
    }
    if (await waitForQr(page, 3_000)) return "qr";
  }

  const loginButtons = page.getByText("登录", { exact: true });
  const loginButton = loginButtons.filter({ visible: true }).first();
  if (await loginButton.count().catch(() => 0) > 0) {
    await loginButton.click().catch(() => undefined);
    if (await waitForQr(page, 2_000)) return "qr";
  }

  // 当前页面入口不可用时再访问官方登录页；使用 commit，避免等待无关资源。
  await page.goto(XHS_LOGIN_URL, { waitUntil: "commit", timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await dismissPlatformNotice(page);
  if (await isRestrictedPage(page)) return "restricted";
  if (await waitForQr(page, 7_000)) return "qr";

  return (await isRestrictedPage(page)) ? "restricted" : "unavailable";
}

async function captureQrDataUrl(page: Page): Promise<string> {
  const deadline = Date.now() + 12_000;
  let candidateCount = 0;
  let largestCandidate = "none";
  while (Date.now() < deadline) {
    const candidates = page.locator(QR_SELECTOR);
    const count = await candidates.count();
    candidateCount = Math.max(candidateCount, count);
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const box = await candidate.boundingBox().catch(() => null);
      if (box) largestCandidate = `${Math.round(box.width)}x${Math.round(box.height)}`;
      if (!box || box.width < MIN_QR_SIZE_PX || box.height < MIN_QR_SIZE_PX) continue;
      const candidateInfo = await candidate.evaluate((element) => {
        const tag = element.tagName.toLowerCase();
        const rect = element.getBoundingClientRect();
        const hint = `${element.id} ${typeof element.className === "string" ? element.className : ""} ${(element as HTMLElement).getAttribute("alt") ?? ""}`;
        let context = "";
        let contextNode: Element | null = element;
        for (let depth = 0; depth < 6 && contextNode; depth += 1, contextNode = contextNode.parentElement) {
          context += ` ${(contextNode as HTMLElement).innerText ?? ""}`;
        }
        context = context.slice(0, 1200);
        const inLoginContext = /扫码|二维码|登录后推荐|小红书如何扫码/i.test(context);
        const ratio = rect.width / Math.max(1, rect.height);
        const image = tag === "img" ? element as HTMLImageElement : null;
        const hasLeaf = Boolean(element.querySelector("canvas, img, svg"));
        const isImageLike = tag === "canvas" || tag === "svg" || Boolean(image?.complete && image.naturalWidth >= 80);
        const isSvgQr = tag === "svg" && /qr|code|二维码/i.test(hint) && rect.width >= 120 && rect.height >= 120;
        const isLikelyQr = /qr|code|二维码/i.test(hint) || tag === "canvas" || isSvgQr || (tag === "img" && inLoginContext && isImageLike && ratio > 0.65 && ratio < 1.45) || (hasLeaf && inLoginContext);
        return { isLikelyQr, isCanvas: tag === "canvas" };
      }).catch(() => ({ isLikelyQr: false, isCanvas: false }));
      if (!candidateInfo.isLikelyQr) continue;
      if (candidateInfo.isCanvas) {
        const dataUrl = await candidate.evaluate((element) => {
          try {
            const data = (element as HTMLCanvasElement).toDataURL("image/png");
            return data.length > 256 ? data : null;
          } catch {
            return null;
          }
        }).catch(() => null);
        if (dataUrl) return dataUrl;
      }
      const leaf = candidate.locator("canvas, img, svg").first();
      const target = await leaf.count().catch(() => 0) > 0 ? leaf : candidate;
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      const png = await target.screenshot({ type: "png", animations: "disabled" }).catch(() => null);
      if (!png) continue;
      const ready = await target.evaluate((element) => {
        if (element.tagName.toLowerCase() !== "img") return true;
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth >= 80;
      }).catch(() => false);
      if (ready && png.length > 512) return `data:image/png;base64,${png.toString("base64")}`;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`未找到可展示的小红书二维码（候选 ${candidateCount}，最大可见尺寸 ${largestCandidate}）`);
}

async function setBrowserWindowVisible(page: Page, visible: boolean): Promise<void> {
  const cdp = await page.context().newCDPSession(page).catch(() => null);
  if (!cdp) return;
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: visible
        ? { windowState: "normal", left: 80, top: 60, width: 1280, height: 860 }
        : { windowState: "normal", left: -32000, top: -32000, width: 1440, height: 960 },
    });
  } catch {
    // Window positioning is a convenience only; connection logic must still work without it.
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export class InMemoryXhsConnectionService implements XhsConnectionService {
  private readonly sessions = new Map<string, LiveSession>();

  constructor(private readonly persistence?: {
    repository: XhsSessionRepository;
    cipher: XhsSessionCipher;
  }) {}

  async create(userId: string): Promise<PlatformConnection> {
    await this.disconnect(userId);

    const createdAt = nowIso();
    // 快速返回：不等待浏览器启动/二维码就绪，由 setup() 异步完成并更新状态，
    // 前端轮询 GET 拿到 qr_image_url 后展示二维码（避免点击后长时间白等）。
    const session: LiveSession = {
      browser: null as unknown as Browser,
      context: null as unknown as BrowserContext,
      page: null as unknown as Page,
      stopped: false,
      connection: {
        id: randomUUID(),
        task_id: randomUUID(),
        platform: "xiaohongshu",
        status: "qr_pending",
        qr_image_url: null,
        qr_expires_at: new Date(Date.now() + QR_TTL_MS).toISOString(),
        session_expires_at: null,
        last_verified_at: null,
        account_display_name: null,
        account_handle_masked: null,
        avatar_url: null,
        message_code: "XHS_QR_STARTING",
        created_at: createdAt,
        updated_at: createdAt,
      },
    };
    this.sessions.set(userId, session);
    await this.persist(userId, session.connection, null);
    void this.setup(userId, session);
    return publicConnection(session.connection);
  }

  // 异步建立浏览器会话并抓取二维码；完成后进入 monitor 循环。
  // 期间用户可随时关闭弹窗（DELETE 连接），setup 会检测 stopped 并中止。
  private async setup(userId: string, session: LiveSession): Promise<void> {
    try {
      session.browser = await launchBrowser();
      // 尽早隐藏窗口：launch 后立刻按已知 PID 轮询隐藏（窗口创建即隐藏）
      void hideBrowserWindowSoon(session.browser);
      if (session.stopped || this.sessions.get(userId) !== session) {
        await this.closeBrowser(session);
        return;
      }
      session.context = await session.browser.newContext({
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        viewport: { width: 1440, height: 960 },
      });
      await prepareContext(session.context);
      session.page = await session.context.newPage();
      if (session.stopped || this.sessions.get(userId) !== session) {
        await this.closeBrowser(session);
        return;
      }
      await session.page.goto(XHS_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
      const loginState = await openLoginPanelStable(session.page);
      if (loginState === "restricted") {
        session.connection.qr_expires_at = new Date(Date.now() + RESTRICTED_TTL_MS).toISOString();
        this.update(session, "restricted", "XHS_PLATFORM_RESTRICTED");
        await this.persist(userId, session.connection, null);
        void this.monitor(userId, session);
        return;
      }
      if (loginState !== "qr") throw new Error("小红书当前登录入口未返回二维码");
      if (await isRestrictedPage(session.page)) {
        // 风控时不自动弹出窗口：保持隐藏，等待用户从页面内主动打开验证窗口
        session.connection.qr_expires_at = new Date(Date.now() + RESTRICTED_TTL_MS).toISOString();
        this.update(session, "restricted", "XHS_PLATFORM_RESTRICTED");
        await this.persist(userId, session.connection, null);
        void this.monitor(userId, session);
        return;
      }

      session.connection.qr_image_url = await captureQrDataUrl(session.page);
      this.update(session, "qr_pending", "XHS_QR_READY");
      await this.persist(userId, session.connection, null);
      void this.monitor(userId, session);
    } catch (error) {
      console.error("[XHS] QR setup failed", error instanceof Error ? error.message : error);
      const messageCode = error instanceof Error && error.message.includes("登录入口")
        ? "XHS_QR_ENTRY_UNAVAILABLE"
        : "XHS_QR_CREATE_FAILED";
      this.update(session, "failed", messageCode);
      await this.persist(userId, session.connection, null).catch(() => undefined);
      await this.closeBrowser(session);
    }
  }

  async get(userId: string): Promise<PlatformConnection> {
    let session = this.sessions.get(userId);
    if (!session && this.persistence) {
      const stored = await this.persistence.repository.load(userId);
      if (!stored) return disconnectedConnection();
      if (stored.connection.status !== "connected" || !stored.encryptedState) {
        if (["qr_pending", "qr_scanned"].includes(stored.connection.status)) {
          stored.connection.status = "expired";
          stored.connection.message_code = "XHS_QR_EXPIRED";
          stored.connection.qr_expires_at = null;
          await this.persistence.repository.save(userId, stored.connection, null);
        }
        return publicConnection(stored.connection);
      }
      const restoredSession = await this.restore(userId, stored.connection, stored.encryptedState);
      if (!restoredSession) {
        stored.connection.status = "expired";
        stored.connection.message_code = "XHS_SESSION_EXPIRED";
        stored.connection.session_expires_at = null;
        stored.connection.last_verified_at = nowIso();
        await this.persistence.repository.save(userId, stored.connection, null);
        return publicConnection(stored.connection);
      }
      session = restoredSession;
    }
    if (!session) return disconnectedConnection();

    if (session.connection.status === "connected") {
      const expiresAt = Date.parse(session.connection.session_expires_at ?? "");
      const cookies = session.page.isClosed()
        ? []
        : await session.context.cookies("https://www.xiaohongshu.com").catch(() => []);
      const hasLoginSession = cookies.some(
        (cookie) => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value.length > 0,
      );
      if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt || !hasLoginSession) {
        this.update(session, "expired", "XHS_SESSION_EXPIRED");
        session.connection.session_expires_at = null;
        await this.persist(userId, session.connection, null);
        await this.closeBrowser(session);
      } else {
        session.connection.last_verified_at = nowIso();
        session.connection.updated_at = session.connection.last_verified_at;
      }
    }

    return publicConnection(session.connection);
  }

  async showVerificationWindow(userId: string): Promise<PlatformConnection> {
    const session = this.sessions.get(userId);
    if (session && session.connection.status === "restricted") {
      await setBrowserWindowVisible(session.page, true);
      const pid = await getBrowserProcessId(session.browser);
      if (pid) await setBrowserWindowOnDesktop(pid, true);
    }
    return publicConnection(session?.connection ?? disconnectedConnection());
  }

  async disconnect(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (!session) {
      await this.persistence?.repository.remove(userId);
      return;
    }
    session.stopped = true;
    this.sessions.delete(userId);
    await this.closeBrowser(session);
    await this.persistence?.repository.remove(userId);
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async (session) => {
      session.stopped = true;
      await this.closeBrowser(session);
    }));
  }

  private update(session: LiveSession, status: PlatformConnectionStatus, messageCode: string): void {
    session.connection.status = status;
    session.connection.message_code = messageCode;
    session.connection.updated_at = nowIso();
  }

  private async closeBrowser(session: LiveSession): Promise<void> {
    await session.browser?.close().catch(() => undefined);
  }

  private async persist(
    userId: string,
    connection: PlatformConnection,
    encryptedState: EncryptedSessionState | null,
  ): Promise<void> {
    if (!this.persistence) return;
    const stored = await this.persistence.repository.save(userId, connection, encryptedState);
    connection.id = stored.connection.id;
    connection.created_at = stored.connection.created_at;
    connection.updated_at = stored.connection.updated_at;
  }

  private async restore(
    userId: string,
    connection: PlatformConnection,
    encryptedState: EncryptedSessionState,
  ): Promise<LiveSession | null> {
    let browser: Browser | null = null;
    try {
      const storageState = this.persistence?.cipher.decrypt(encryptedState);
      browser = await launchBrowser();
      void hideBrowserWindowSoon(browser);
      const context = await browser.newContext({
        locale: "zh-CN",
        timezoneId: "Asia/Shanghai",
        viewport: { width: 1440, height: 960 },
        storageState: storageState as Awaited<ReturnType<BrowserContext["storageState"]>>,
      });
      await prepareContext(context);
      const page = await context.newPage();
      // 登录入口只需要首屏 DOM；把网络异常的最长等待从 60s 降到 35s，避免用户长时间看到“生成中”。
      await page.goto(XHS_HOME_URL, { waitUntil: "domcontentloaded", timeout: 35_000 });
      const cookies = await context.cookies("https://www.xiaohongshu.com");
      const hasLoginSession = cookies.some(
        (cookie) => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value.length > 0,
      );
      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (!hasLoginSession || RESTRICTED_PATTERN.test(bodyText)) {
        await browser.close();
        return null;
      }
      const session: LiveSession = { connection, browser, context, page, stopped: false };
      connection.last_verified_at = nowIso();
      connection.message_code = "XHS_CONNECTED_RESTORED";
      connection.updated_at = connection.last_verified_at;
      connection.avatar_url = await scrapeAvatarUrl(page);
      this.sessions.set(userId, session);
      return session;
    } catch {
      await browser?.close().catch(() => undefined);
      return null;
    }
  }

  private async monitor(userId: string, session: LiveSession): Promise<void> {
    try {
      while (!session.stopped && this.sessions.get(userId) === session) {
        if (Date.now() >= Date.parse(session.connection.qr_expires_at ?? "")) {
          session.connection.qr_image_url = null;
          this.update(session, "expired", "XHS_QR_EXPIRED");
          await this.persist(userId, session.connection, null);
          await this.closeBrowser(session);
          return;
        }

        if (session.page.isClosed()) {
          this.update(session, "failed", "XHS_BROWSER_CLOSED");
          return;
        }

        const bodyText = await session.page.locator("body").innerText().catch(() => "");
        const cookies = await session.context.cookies("https://www.xiaohongshu.com");
        const hasLoginSession = cookies.some(
          (cookie) => LOGIN_COOKIE_NAMES.has(cookie.name) && cookie.value.length > 0,
        );
        const loginButtonVisible = await session.page
          .getByText("登录", { exact: true })
          .first()
          .isVisible()
          .catch(() => false);

        if (hasLoginSession && !loginButtonVisible) {
          if (session.connection.status === "qr_pending") {
            this.update(session, "qr_scanned", "XHS_QR_SCANNED");
            await session.page.waitForTimeout(1_000);
          }
          const verifiedAt = nowIso();
          session.connection.qr_image_url = null;
          session.connection.qr_expires_at = null;
          session.connection.session_expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
          session.connection.last_verified_at = verifiedAt;
          session.connection.avatar_url = await scrapeAvatarUrl(session.page);
          this.update(session, "connected", "XHS_CONNECTED_MEMORY_ONLY");
          if (this.persistence) {
            const storageState = await session.context.storageState();
            const encryptedState = this.persistence.cipher.encrypt(storageState);
            this.update(session, "connected", "XHS_CONNECTED");
            await this.persist(userId, session.connection, encryptedState);
          }
          return;
        }

        const restricted = await isRestrictedPage(session.page);
        if (restricted) {
          session.connection.qr_image_url = null;
          if (session.connection.status !== "restricted") {
            session.connection.qr_expires_at = new Date(Date.now() + RESTRICTED_TTL_MS).toISOString();
            this.update(session, "restricted", "XHS_PLATFORM_RESTRICTED");
            await this.persist(userId, session.connection, null);
          }
          await session.page.waitForTimeout(POLL_INTERVAL_MS);
          continue;
        }

        if (session.connection.status === "restricted") {
          // 风控页面已解除：重新打开登录面板并抓取二维码；窗口保持隐藏，由用户从页面内主动打开验证
          try {
            const loginState = await openLoginPanelStable(session.page);
            if (loginState !== "qr") throw new Error("二维码暂不可用");
            session.connection.qr_image_url = await captureQrDataUrl(session.page);
            void hideBrowserWindowSoon(session.browser);
            session.connection.qr_expires_at = new Date(Date.now() + QR_TTL_MS).toISOString();
            this.update(session, "qr_pending", "XHS_QR_READY");
            await this.persist(userId, session.connection, null);
          } catch {
            // 风险页尚未清除：保持 restricted，下一轮重试
            session.connection.qr_image_url = null;
            await session.page.waitForTimeout(POLL_INTERVAL_MS);
            continue;
          }
        }

        if (SCANNED_PATTERN.test(bodyText) && session.connection.status === "qr_pending") {
          this.update(session, "qr_scanned", "XHS_QR_SCANNED");
        }

        await session.page.waitForTimeout(POLL_INTERVAL_MS);
      }
    } catch {
      if (!session.stopped && this.sessions.get(userId) === session) {
        session.connection.qr_image_url = null;
        this.update(session, "failed", "XHS_MONITOR_FAILED");
        await this.persist(userId, session.connection, null).catch(() => undefined);
        await this.closeBrowser(session);
      }
    }
  }
}
