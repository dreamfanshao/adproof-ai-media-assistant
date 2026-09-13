import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1093, height: 817 } });
const browserErrors = [];
page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
page.on("pageerror", (error) => browserErrors.push(error.message));

try {
  await page.goto("http://127.0.0.1:5173/scripts/test/model-settings-ui-fixture.html", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /DeepSeek/ }).click();
  const apiKeyInput = page.getByRole("textbox", { name: "API Key" });
  await apiKeyInput.fill("sk-deepseek-ui-test-key");
  const actions = page.locator(".model-settings-actions");
  const actionsBeforeNotice = await actions.boundingBox();
  await page.getByRole("button", { name: "刷新可用模型" }).click();
  await page.getByText(/已从 DeepSeek 实时刷新，共发现 2 个可用模型。/).waitFor();
  const actionsAfterNotice = await actions.boundingBox();
  assert.equal(actionsBeforeNotice?.y, actionsAfterNotice?.y, "status messages must not move the action buttons");
  assert.equal(await page.getByLabel("模型", { exact: true }).inputValue(), "deepseek-flash", "a stale selection must switch to the provider's live model list");
  assert.equal(await page.getByLabel("模型", { exact: true }).locator('option[value="deepseek-v4-flash"]').count(), 0, "stale hard-coded models must be removed after refresh");
  await page.getByLabel("模型", { exact: true }).selectOption("deepseek-v4-pro");
  await page.getByRole("button", { name: "测试连接" }).click();
  await page.getByText("DeepSeek 连接成功，所选模型可用。").waitFor();
  await page.getByRole("button", { name: "保存并启用" }).click();
  await page.getByText("DeepSeek 已设为系统当前模型，后续任务会自动使用。").waitFor();
  assert.equal(await apiKeyInput.inputValue(), "");
  assert.equal(await page.getByText("当前使用").count(), 1);
  assert.equal(await page.getByRole("dialog").evaluate((node) => node.scrollHeight <= node.clientHeight), true, "desktop dialog must fit without scrolling");
  assert.equal(await page.locator(".model-settings-page").evaluate((node) => node.scrollHeight <= node.clientHeight), true, "desktop panel must fit without scrolling");
  assert.deepEqual(browserErrors, []);
  if (process.env.MODEL_SETTINGS_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_SETTINGS_SCREENSHOT, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("body").evaluate((node) => node.scrollWidth <= window.innerWidth), true);
  console.log("Model settings UI passed: fixed status area, refresh, test, save, key clearing, and mobile overflow checks.");
} finally {
  await browser.close();
}
