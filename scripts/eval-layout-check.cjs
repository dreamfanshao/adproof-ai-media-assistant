const { chromium } = require("playwright");

const baseUrl = process.env.EVAL_URL || "http://127.0.0.1:3081";

async function inspect(viewport, name) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/eval`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `eval-layout-${name}-eval.png`, fullPage: true });

  const tabs = page.locator(".tab");
  const labels = await tabs.allTextContents();
  const results = [];
  for (let index = 0; index < labels.length; index += 1) {
    await tabs.nth(index).click();
    await page.locator("#workspaceLoading").waitFor({ state: "hidden" });
    await page.waitForTimeout(700);
    const frame = page.frames().find((item) => item !== page.mainFrame());
    const child = frame
      ? await frame.evaluate(() => ({
          path: location.pathname + location.hash,
          width: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          bodyText: document.body.innerText.slice(0, 500),
          nestedWorkspaceTabs: Boolean(document.querySelector("#workspaceTabs")) && getComputedStyle(document.querySelector("#workspaceTabs")).display !== "none",
          nestedTopbar: Boolean(document.querySelector(".topbar")) && getComputedStyle(document.querySelector(".topbar")).display !== "none",
          nestedSide: Boolean(document.querySelector(".eval-side")) && getComputedStyle(document.querySelector(".eval-side")).display !== "none",
        }))
      : null;
    results.push({ label: labels[index].trim(), child });
  }

  const dimensions = await page.evaluate(() => ({
    url: location.href,
    width: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    tabScrollWidth: document.querySelector(".tabs")?.scrollWidth,
    tabClientWidth: document.querySelector(".tabs")?.clientWidth,
  }));
  await page.screenshot({ path: `eval-layout-${name}-last.png`, fullPage: true });
  await browser.close();
  return { viewport, labels, dimensions, errors, results };
}

(async () => {
  const desktop = await inspect({ width: 1440, height: 900 }, "desktop");
  const mobile = await inspect({ width: 390, height: 844 }, "mobile");
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
