import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url);
const localEnv = readFileSync(new URL(".env.local", root), "utf8").replace(/^\uFEFF/, "");
const localValue = (key) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? localValue("VITE_SUPABASE_URL");
if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL is required");

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const taskId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const accessToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: userId, role: "authenticated", aud: "authenticated", exp: expiresAt })}.`;
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "ui-test@example.invalid", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: accessToken, refresh_token: "mock-refresh-token", expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user };
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;
const searchStorageKey = `adproof.creator-search.${userId}.${projectId}`;
const screenshotPath = process.env.SCREENSHOT_PATH ?? path.join(os.tmpdir(), "search-cancel-ui.png");
const activeScreenshotPath = process.env.ACTIVE_SCREENSHOT_PATH ?? path.join(os.tmpdir(), "search-cancel-ui-active.png");
let active = true;
const cancelRequests = [];

const taskView = () => ({
  id: taskId,
  task_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  user_id: userId,
  project_id: projectId,
  query_text: "粉丝少于1500，有真实护肤体验",
  confirmed_rule: {},
  target_count: 20,
  status: active ? "analyzing" : "cancelled",
  progress: 52,
  terminal: !active,
  can_continue: false,
  collected_count: 18,
  persisted_count: 0,
  duplicate_count: 0,
  stage_counts: { notes_collected: 18, creators_discovered: 15, analysis_errors: 0, persisted: 0 },
  loop_state: { action: "collecting", iteration: 1 },
  error_message: null,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:01:00.000Z",
});
const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ key, value, project }) => {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem("adproof.activeProjectId", project);
  }, { key: storageKey, value: session, project: projectId });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/me")) return json(route, { data: { id: user.id, email: user.email, display_name: "UI 测试" } });
    if (url.pathname.endsWith("/projects") && request.method() === "GET") return json(route, { data: [{ id: projectId, name: "取消检索测试", product_name: "护肤", status: "active" }] });
    if (url.pathname.endsWith(`/projects/${projectId}/creators`)) return json(route, { data: [] });
    if (url.pathname.endsWith(`/projects/${projectId}/search-tasks`) && request.method() === "GET") return json(route, { data: [taskView()] });
    if (url.pathname.endsWith(`/search-tasks/${taskId}`) && request.method() === "GET") return json(route, { data: taskView() });
    if (url.pathname.endsWith(`/search-tasks/${taskId}/cancel`) && request.method() === "POST") {
      cancelRequests.push(url.pathname);
      active = false;
      return json(route, { data: { id: taskId, status: "cancelled" } });
    }
    if (url.pathname.endsWith("/redfox-credential") && request.method() === "GET") return json(route, { data: { configured: true, source: "system", fingerprint: null, updated_at: null, replaceable: true } });
    return json(route, { data: [] });
  });
  await page.route("**/auth/v1/**", (route) => json(route, { user }));

  await page.goto(`${process.env.APP_URL ?? "http://127.0.0.1:5173"}/creators`);
  await page.waitForLoadState("networkidle");
  const cancelButton = page.getByRole("button", { name: "取消检索" });
  await cancelButton.waitFor();
  await page.getByText("正在检索：", { exact: false }).waitFor();
  await page.screenshot({ path: activeScreenshotPath, fullPage: true });
  await cancelButton.click();
  await page.getByText("本次检索已停止", { exact: true }).waitFor();

  assert.deepEqual(cancelRequests, [`/api/v1/search-tasks/${taskId}/cancel`]);
  assert.equal(await page.getByRole("button", { name: "取消检索" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "开始检索" }).isEnabled(), true);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), searchStorageKey), null);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(JSON.stringify({ ok: true, cancelRequests: cancelRequests.length, activeScreenshot: activeScreenshotPath, screenshot: screenshotPath }));
} finally {
  await browser.close();
}
