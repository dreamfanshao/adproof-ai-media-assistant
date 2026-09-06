import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageErrors = [];
const consoleErrors = [];

page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  const response = await page.goto("http://127.0.0.1:5173/login", { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`login page returned ${response?.status() ?? "no response"}`);

  const health = await page.evaluate(async () => {
    const result = await fetch("/api/v1/health", { headers: { Accept: "application/json" } });
    const text = await result.text();
    let jsonValid = false;
    try {
      JSON.parse(text);
      jsonValid = true;
    } catch {
      jsonValid = false;
    }
    return { status: result.status, contentType: result.headers.get("content-type"), jsonValid };
  });

  if (health.status !== 200 || !health.jsonValid) {
    throw new Error(`proxied health check failed: ${JSON.stringify(health)}`);
  }
  if (pageErrors.length || consoleErrors.length) {
    throw new Error(`browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
  }

  console.log(JSON.stringify({ page: "login", pageStatus: response.status(), health, pageErrors, consoleErrors }, null, 2));
} finally {
  await browser.close();
}
