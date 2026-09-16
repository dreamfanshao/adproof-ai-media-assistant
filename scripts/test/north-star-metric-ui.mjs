import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  const overviewResponse = await page.request.get("http://127.0.0.1:3081/api/analytics/overview");
  assert.equal(overviewResponse.ok(), true, `analytics overview returned ${overviewResponse.status()}`);
  const overview = (await overviewResponse.json()).data;
  const expectedRate = overview.creatorSelectionRate == null ? "—" : `${overview.creatorSelectionRate}%`;
  const expectedDetail = overview.retrievedCreators
    ? `已选 ${overview.selectedCreators} ÷ 检索 ${overview.retrievedCreators}`
    : "暂无已进入候选池的达人";

  await page.goto("http://127.0.0.1:3081/admin", { waitUntil: "networkidle" });
  const frame = page.frames().find((candidate) => candidate.url().includes("/workspace/admin"));
  assert.ok(frame, "后台管理 iframe 未加载");
  const northStar = frame.locator(".admin-north-star");
  await northStar.waitFor({ state: "visible" });
  const text = await northStar.innerText();
  for (const expected of ["北极星指标", "已选达人转化率", expectedRate, expectedDetail]) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  console.log(`NORTH_STAR_UI_OK: ${expectedRate} (${expectedDetail})`);
} finally {
  await browser.close();
}
