import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const localEnv = readFileSync(".env.local", "utf8").replace(/^\uFEFF/, "");
const localValue = (key) => localEnv.split(/\r?\n/).find((line) => line.startsWith(`${key}=`))?.slice(key.length + 1).trim();
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? localValue("VITE_SUPABASE_URL");
if (!supabaseUrl) throw new Error("VITE_SUPABASE_URL is required");

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const expiresAt = Math.floor(Date.now() / 1000) + 3600;
const accessToken = `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "ui-test-user", role: "authenticated", aud: "authenticated", exp: expiresAt })}.`;
const user = { id: "ui-test-user", aud: "authenticated", role: "authenticated", email: "ui-test@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: accessToken, refresh_token: "ui-test-refresh", expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user };
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
const storageKey = `sb-${projectRef}-auth-token`;

const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json; charset=utf-8", body: JSON.stringify(body) });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(({ key, value }) => {
  localStorage.setItem(key, JSON.stringify(value));
  localStorage.setItem("adproof.activeProjectId", "project-ui-test");
}, { key: storageKey, value: session });

const page = await context.newPage();
const pageErrors = [];
const createdSearchBodies = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.route("**/api/v1/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith("/me")) return json(route, { data: { id: user.id, email: user.email, display_name: "UI 验收", created_at: user.created_at, updated_at: user.created_at } });
  if (url.pathname.endsWith("/projects")) return json(route, { data: [{ id: "project-ui-test", name: "医美素人博主", product_name: "医美", status: "active" }] });
  if (url.pathname.endsWith("/projects/project-ui-test/creators")) return json(route, { data: [{ id: "creator-row-1", decision_status: "pending", contact_status: "not_contacted", followers: 1280, activity_score: 72, match_score: 91, evidence_summary: "光子嫩肤体验记录", created_at: "2026-08-29T01:04:00.000Z", updated_at: "2026-08-29T01:04:00.000Z", captured_at: "2026-08-29T01:04:00.000Z", creators: { platform: "xiaohongshu", nickname: "测试达人", handle: "creator-test", profile_url: "https://www.xiaohongshu.com/user/profile/creator-test", avatar_url: null, platform_creator_id: "creator-test", latest_snapshot: {} } }] });
  if (url.pathname.endsWith("/projects/project-ui-test/search-rules:parse") && route.request().method() === "POST") return json(route, { data: { hard_filters: { followers: { operator: "lt", value: 1500 } } } });
  if (url.pathname.endsWith("/projects/project-ui-test/search-tasks") && route.request().method() === "POST") {
    createdSearchBodies.push(route.request().postDataJSON());
    return json(route, { data: { id: "search-task-new" } });
  }
  if (url.pathname.endsWith("/projects/project-ui-test/search-tasks")) return json(route, { data: [{ id: "search-task-1", task_id: "job-1", user_id: user.id, project_id: "project-ui-test", query_text: "粉丝小于1500，有医美经历", confirmed_rule: {}, target_count: 20, status: "completed", progress: 100, terminal: true, can_continue: true, collected_count: 103, persisted_count: 20, duplicate_count: 17, stage_counts: { notes_collected: 107, creators_discovered: 103, existing_duplicates: 17, persisted: 20 }, partial_reason: null, message_code: "SEARCH_COMPLETED", error_code: null, error_message: null, model_version: "redfox-skill-agent-v1", prompt_version: "creator-agent.v2", created_at: "2026-08-29T01:04:00.000Z", updated_at: "2026-08-29T01:20:00.000Z" }] });
  if (url.pathname.endsWith("/search-tasks/search-task-new")) return json(route, { data: { id: "search-task-new", task_id: "job-new", user_id: user.id, project_id: "project-ui-test", query_text: "粉丝小于1500，有医美经历", confirmed_rule: {}, target_count: 20, status: "completed", progress: 100, terminal: true, collected_count: 120, persisted_count: 20, duplicate_count: 20, stage_counts: { notes_collected: 120, creators_discovered: 100, existing_duplicates: 20, persisted: 20 }, error_message: null } });
  return json(route, { data: [] });
});

await page.goto("http://127.0.0.1:5173/creators");
await page.waitForLoadState("networkidle");
const startButton = page.getByRole("button", { name: "开始检索" });
await startButton.waitFor();
await page.getByRole("button", { name: "导出 Excel" }).waitFor();
if (await page.getByRole("button", { name: /继续补足|继续检索/ }).count()) throw new Error("legacy continue button is still visible");

await startButton.click();
await page.getByText("本批已新增 20 人。再次点击“开始检索”可获取下一批，项目历史达人会自动排除。").waitFor();
if (createdSearchBodies.length !== 1) throw new Error(`expected one batch request, got ${createdSearchBodies.length}`);
if (createdSearchBodies[0]?.target_count !== 20) throw new Error(`batch target must be 20: ${JSON.stringify(createdSearchBodies[0])}`);
if (await startButton.isDisabled()) throw new Error("start button did not become available after the batch completed");

const startStyle = await startButton.evaluate((element) => ({
  color: getComputedStyle(element).color,
  background: getComputedStyle(element).backgroundColor,
  disabled: element.disabled,
  labelColor: getComputedStyle(element.querySelector("span")).color,
}));
const exportStyle = await page.getByRole("button", { name: "导出 Excel" }).evaluate((element) => ({
  color: getComputedStyle(element).color,
  background: getComputedStyle(element).backgroundColor,
  border: getComputedStyle(element).borderColor,
}));

if (startStyle.color !== "rgb(255, 255, 255)") throw new Error(`start button contrast failed: ${JSON.stringify(startStyle)}`);
if (startStyle.disabled || startStyle.labelColor !== "rgb(255, 255, 255)") throw new Error(`start button label failed: ${JSON.stringify(startStyle)}`);
if (exportStyle.background !== "rgb(255, 255, 255)") throw new Error(`export button background failed: ${JSON.stringify(exportStyle)}`);
if (exportStyle.color === "rgb(255, 255, 255)" || exportStyle.color === "rgb(0, 0, 0)") throw new Error(`export button text failed: ${JSON.stringify(exportStyle)}`);
if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(" | ")}`);

await page.screenshot({ path: `${process.env.TEMP ?? "."}/adproof-creators-actions.png`, fullPage: true });
console.log(JSON.stringify({ url: page.url(), startStyle, exportStyle, createdSearchBodies, pageErrors, screenshot: `${process.env.TEMP ?? "."}/adproof-creators-actions.png` }));
await browser.close();
