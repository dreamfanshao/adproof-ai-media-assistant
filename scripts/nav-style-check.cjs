const { chromium } = require("playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:3081";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto(`${base}/eval`, { waitUntil: "networkidle" });
  const frame = page.frameLocator("#workspaceFrame");
  await page.getByRole("tab", { name: "后台管理", exact: true }).click();
  await frame.locator("#adminTabs").waitFor();
  const adminLayout = await frame.locator("#adminTabs").evaluate((el) => ({ direction: getComputedStyle(el).flexDirection, display: getComputedStyle(el).display }));
  const adminStripe = await frame.locator(".module-stripe").evaluate((el) => getComputedStyle(el).display);
  if (adminLayout.direction !== "row" || adminStripe !== "none") failures.push(`admin layout=${JSON.stringify(adminLayout)}, stripe=${adminStripe}`);
  await page.getByRole("tab", { name: "评测中心", exact: true }).click();
  await frame.locator(".notice").waitFor({ state: "attached" });
  const evalNotice = await frame.locator(".notice").evaluate((el) => getComputedStyle(el).display);
  if (evalNotice !== "none") failures.push(`eval notice display=${evalNotice}`);
  for (const label of ["Skills", "Tools", "Planner", "模型管理"]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    const stripe = await frame.locator(".module-stripe").evaluate((el) => getComputedStyle(el).display).catch(() => "missing");
    if (stripe !== "none" && stripe !== "missing") failures.push(`${label} stripe=${stripe}`);
  }
  await page.screenshot({ path: "test-results/navigation-style.png", fullPage: true });
  if (failures.length) throw new Error(failures.join("; "));
  console.log("navigation: admin tabs horizontal, all module stripes hidden, Eval notice hidden");
  if (failures.length) process.exitCode = 1;
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
