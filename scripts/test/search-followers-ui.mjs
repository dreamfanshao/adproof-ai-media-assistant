import assert from "node:assert/strict";
import { chromium } from "playwright";

// Isolated component fixture: no login, no writes to application data.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { CreatorTable } = await import("/src/components/creator-table.tsx");
    const { mapProjectCreator } = await import("/src/lib/project-api.ts");
    const values = [null, 0, 147, 769, 1291];
    const rows = values.map((followers, i) => mapProjectCreator({
      id: `fixture-${i}`, followers, match_score: 100 - i, activity_score: 60,
      decision_status: "pending", contact_status: "not_contacted", evidence_summary: "UI fixture only",
      created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z", captured_at: null,
      creators: { nickname: `Fixture ${i}`, platform_creator_id: `fixture-${i}` },
    }));
    const container = document.createElement("div");
    container.id = "followers-test";
    document.body.replaceChildren(container);
    ReactDOM.createRoot(container).render(React.createElement(CreatorTable, { creators: rows, onStatusChange: () => {} }));
  });
  await page.waitForSelector("#followers-test tbody tr");
  const counts = () => page.locator("#followers-test tbody tr td:nth-child(3)").allTextContents();
  assert.deepEqual(await counts(), ["未知", "0", "147", "769", "1,291"]);
  await page.getByRole("button", { name: "按粉丝排序", exact: true }).click();
  assert.deepEqual(await counts(), ["1,291", "769", "147", "0", "未知"]);
  await page.getByRole("button", { name: "按粉丝排序", exact: true }).click();
  assert.deepEqual(await counts(), ["0", "147", "769", "1,291", "未知"]);
  assert.deepEqual(errors, []);
  console.log("PASS: real component mapping, exact sub-1000 counts, true zero, unknown, ascending/descending sorting, no browser errors");
} finally { await browser.close(); }
