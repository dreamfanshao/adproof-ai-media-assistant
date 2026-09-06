// T07 Phase 1｜Worker 受控浏览器启动：有头 Edge 但窗口对用户彻底不可见（SW_HIDE）
// 与 server 端 T06 方案一致：headless 会被小红书风控拦截，必须保持有头
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Browser } from "playwright";

const execFileAsync = promisify(execFile);

const LAUNCH_ARGS = [
  "--start-minimized",
  "--window-position=-32000,-32000",
  "--window-size=1440,960",
  "--disable-blink-features=AutomationControlled",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-infobars",
];

const SET_BROWSER_WINDOW_SCRIPT = `
Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class W32Win{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);}';
$deadline=(Get-Date).AddSeconds(10); $done=$false;
while((Get-Date)-lt $deadline -and -not $done){
  $p=Get-Process -Id $env:WINDOW_PID -ErrorAction SilentlyContinue;
  if($p -and $p.MainWindowHandle -ne 0){ [W32Win]::ShowWindow($p.MainWindowHandle,[int]$env:SW_ACTION) | Out-Null; $done=$true }
  else { Start-Sleep -Milliseconds 200 }
}
`;

async function setBrowserWindowOnDesktop(browserPid: number, visible: boolean): Promise<void> {
  if (process.platform !== "win32" || !Number.isInteger(browserPid)) return;
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", SET_BROWSER_WINDOW_SCRIPT], {
      env: { ...process.env, WINDOW_PID: String(browserPid), SW_ACTION: visible ? "5" : "0" },
      windowsHide: true,
      timeout: 12_000,
    });
  } catch {
    // 窗口显隐是体验优化，失败不阻断采集逻辑
  }
}

async function getBrowserProcessId(browser: Browser): Promise<number | null> {
  try {
    const cdp = await browser.newBrowserCDPSession();
    try {
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      const browserProcess = processInfo?.find((entry: { type?: string }) => entry.type === "browser");
      return browserProcess?.id ?? null;
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

export async function launchHiddenBrowser(): Promise<Browser> {
  const browser = await chromium.launch({ channel: "msedge", headless: false, args: LAUNCH_ARGS });
  const pid = await getBrowserProcessId(browser);
  if (pid) void setBrowserWindowOnDesktop(pid, false);
  return browser;
}
