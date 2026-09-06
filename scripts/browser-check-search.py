import subprocess


NODE_CHECK = r"""
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const response = await page.goto('http://127.0.0.1:5173/creators', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  const body = await page.locator('body').innerText();
  console.log(JSON.stringify({
    status: response && response.status(),
    url: page.url(),
    title: await page.title(),
    hasLogin: body.includes('登录'),
    hasCreatorSearch: body.includes('找达人'),
    bodyPreview: body.slice(0, 300),
  }));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
"""


def main() -> None:
    subprocess.run(["node", "-e", NODE_CHECK], check=True)


if __name__ == "__main__":
    main()
