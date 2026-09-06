import { chromium } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";

const browser = await chromium.launch({ channel: "msedge", headless: false });
const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 960 } });
const page = await context.newPage();

try {
  await page.goto("https://www.xiaohongshu.com/explore", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const loginButtons = page.getByText("登录", { exact: true });
  for (let index = 0; index < await loginButtons.count(); index += 1) {
    const button = loginButtons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      break;
    }
  }
  const loginSearchPrompt = page.getByPlaceholder(/登录.*探索|登录/).first();
  if (await loginSearchPrompt.isVisible().catch(() => false)) {
    await loginSearchPrompt.fill("光子嫩肤");
    const inputBox = loginSearchPrompt.locator("xpath=..");
    const searchTrigger = inputBox.locator("button, [role='button'], svg").last();
    if (await searchTrigger.isVisible().catch(() => false)) {
      await searchTrigger.click();
    } else {
      const box = await inputBox.boundingBox();
      if (box) await inputBox.click({ position: { x: box.width - 24, y: box.height / 2 } });
    }
  }
  await page.waitForTimeout(3_000);

  const loginControls = await page
    .locator('button:has-text("登录"), [role="button"]:has-text("登录"), a:has-text("登录")')
    .evaluateAll((nodes) => nodes.slice(0, 20).map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        tag: node.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
        text: element.innerText.trim().slice(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }));
  const loginPromptDetails = await page.getByPlaceholder(/登录.*探索|登录/).first().evaluate((node) => {
    const input = node as HTMLInputElement;
    const ancestors: string[] = [];
    let current: HTMLElement | null = input;
    for (let index = 0; index < 4 && current; index += 1) {
      ancestors.push(`${current.tagName.toLowerCase()}.${typeof current.className === "string" ? current.className : ""}`);
      current = current.parentElement;
    }
    return { disabled: input.disabled, readOnly: input.readOnly, ancestors };
  }).catch(() => null);

  const elements = await page.locator("canvas, img, svg").evaluateAll((nodes) => nodes
    .map((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      const image = node instanceof HTMLImageElement ? node : null;
      const sourceKind = image?.src.startsWith("data:")
        ? "data"
        : image?.src.startsWith("blob:")
          ? "blob"
          : image?.src.startsWith("http")
            ? "http"
            : image?.src ? "other" : null;
      return {
        tag: node.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
        alt: image?.alt.slice(0, 80) ?? "",
        sourceKind,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0,
      };
    })
    .filter((item) => item.visible && (item.width >= 60 || item.height >= 60))
    .slice(0, 40));

  console.log(JSON.stringify({
    origin: new URL(page.url()).origin,
    loginTextCount: await page.getByText("登录", { exact: true }).count(),
    loginControls,
    loginPromptDetails,
    elements,
  }, null, 2));
  const screenshotPath = join(tmpdir(), "adproof-xhs-login-diagnostic.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`SCREENSHOT_PATH=${screenshotPath}`);
} finally {
  await browser.close();
}
