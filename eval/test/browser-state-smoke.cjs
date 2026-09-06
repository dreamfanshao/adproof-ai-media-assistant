const assert = require("node:assert/strict");
const { chromium } = require("playwright");

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  let runPostCount = 0;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => console.error("PAGEERROR", error.message));

  const creators = {
    data: {
      cases: [{
        id: "refresh-state-case",
        name: "刷新状态保持",
        category: "回归",
        difficulty: "medium",
        enabled: true,
        minimumPersistedCount: 20,
        question: "刷新后仍应显示运行中",
        expectedBehavior: ["禁止重复启动"],
      }],
      executions: [{
        module: "creators",
        caseId: "refresh-state-case",
        status: "running",
        startedAt: "2026-09-02T10:00:00.000Z",
        finishedAt: null,
        run: null,
        error: null,
      }],
      runs: [],
      batches: [],
    },
  };
  const audit = { data: { cases: [], executions: [], runs: [], batches: [] } };

  await page.route("**/api/module-eval/creators", async (route) => {
    if (route.request().method() === "POST") runPostCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(creators) });
  });
  await page.route("**/api/module-eval/audit", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(audit),
  }));

  await page.goto("http://127.0.0.1:3081/workspace/ops", { waitUntil: "domcontentloaded" });
  let button = page.locator('[data-action="run-case"][data-id="refresh-state-case"]');
  await button.waitFor({ timeout: 5000 });
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.textContent(), "真实测试中…");
  assert.match(await page.locator("#case-result-creators-refresh-state-case").textContent(), /RUNNING/);

  await page.reload({ waitUntil: "domcontentloaded" });
  button = page.locator('[data-action="run-case"][data-id="refresh-state-case"]');
  await button.waitFor({ timeout: 5000 });
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.textContent(), "真实测试中…");
  assert.match(await page.locator("#case-result-creators-refresh-state-case").textContent(), /刷新页面不会中断任务/);
  await button.evaluate((element) => element.click());
  await page.waitForTimeout(100);
  assert.equal(runPostCount, 0);
  assert.deepEqual(consoleErrors, []);

  await page.unrouteAll({ behavior: "wait" });
  await page.goto("http://127.0.0.1:3081/workspace/planner", { waitUntil: "domcontentloaded" });
  await page.locator('[data-tab="preview"]').click();
  const plannerButton = page.locator("#preview");
  await plannerButton.waitFor({ timeout: 5000 });
  assert.equal(await plannerButton.textContent(), "校验生产编排");
  assert.match(await page.locator("#panel").textContent(), /不调用模型、RedFox，不写数据库/);
  await plannerButton.click();
  const plannerResult = page.locator("#previewResult");
  await plannerResult.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#previewResult")?.textContent?.includes('"testMode"'));
  const plannerOutput = JSON.parse(await plannerResult.textContent());
  assert.equal(plannerOutput.testMode, "runtime_manifest_validation");
  assert.equal(plannerOutput.modelCalled, false);
  assert.equal(plannerOutput.redfoxCalled, false);
  assert.equal(plannerOutput.databaseWritten, false);

  await page.goto("http://127.0.0.1:3081/workspace/tools", { waitUntil: "domcontentloaded" });
  const contractButton = page.locator('[data-tool="redfox_search_notes"]');
  await contractButton.waitFor({ timeout: 5000 });
  assert.equal(await contractButton.textContent(), "验证调用契约");
  await contractButton.click();
  const contractOutput = contractButton.locator("xpath=following-sibling::div[1]");
  await page.waitForFunction(() => document.querySelector('[data-tool="redfox_search_notes"]')?.nextElementSibling?.textContent?.includes('"testMode"'));
  const contractResult = JSON.parse(await contractOutput.textContent());
  assert.equal(contractResult.testMode, "contract_validation");
  assert.equal(contractResult.externalServiceCalled, false);

  const localButton = page.locator('[data-tool="dedupe_candidates"]');
  assert.equal(await localButton.textContent(), "运行本地测试");
  await localButton.click();
  const localOutput = localButton.locator("xpath=following-sibling::div[1]");
  await page.waitForFunction(() => document.querySelector('[data-tool="dedupe_candidates"]')?.nextElementSibling?.textContent?.includes('"testMode"'));
  const localResult = JSON.parse(await localOutput.textContent());
  assert.equal(localResult.testMode, "local_execution");
  assert.equal(localResult.externalServiceCalled, false);
  assert.equal(localResult.output.before, 3);
  assert.equal(localResult.output.after, 2);

  console.log(JSON.stringify({
    refreshRestoredRunningState: true,
    duplicatePostPrevented: true,
    plannerMode: plannerOutput.testMode,
    plannerExternalCalls: plannerOutput.modelCalled || plannerOutput.redfoxCalled,
    redfoxToolMode: contractResult.testMode,
    localToolMode: localResult.testMode,
    consoleErrors,
  }));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
