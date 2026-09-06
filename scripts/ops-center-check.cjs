const { chromium } = require("playwright");
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3081";

const sizes = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const size of sizes) {
      const page = await browser.newPage({ viewport: size });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${baseUrl}/eval`, { waitUntil: "networkidle" });
      await page.getByRole("tab", { name: "运营中心", exact: true }).click();
      const frame = page.frameLocator("#workspaceFrame");
      await frame.getByRole("heading", { name: "运营中心", exact: true }).waitFor();
      const checks = [
        ["运行监控", "运行监控", "刷新数据"], ["服务评分", "服务评分", "提交评分"], ["评测集", "评测集", "新增用例"],
        ["评测中心", "评测中心", /运行已选/], ["数据标注", "数据标注", "保存标注"], ["改进建议", "生成改进建议", "生成草案"],
        ["人工评估", "人工评估", null], ["版本回滚", "达人检索 Skill 版本", "查看版本"], ["Prompt A/B", "Prompt A/B", "创建实验"],
      ];
      for (const [label, heading, action] of checks) {
        await frame.getByRole("tab", { name: label, exact: true }).click();
        await frame.getByRole("heading", { name: heading, exact: true }).waitFor();
        if (action) await frame.getByRole("button", { name: action }).first().waitFor();
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      const frameOverflow = await frame.locator("body").evaluate((body) => body.scrollWidth > body.clientWidth + 2);
      if (errors.length || overflow || frameOverflow) {
        throw new Error(`${size.name}: errors=${errors.join(" | ")}, overflow=${overflow}, frameOverflow=${frameOverflow}`);
      }
      await page.screenshot({ path: `test-results/ops-center-${size.name}.png`, fullPage: true });
      console.log(`${size.name}: 9 tabs passed, no page errors, no horizontal overflow`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
