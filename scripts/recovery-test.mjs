/**
 * Recovery flow test: guide shows while omp is missing → healthy bridge swaps
 * in → clicking 重新检测 flips the UI back to the chat.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 8787;

function startBridge(missing) {
  const child = spawn(process.execPath, ["server/bridge.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT),
      ...(missing ? { OMP_BIN: "definitely-not-omp-xyz" } : {}),
    },
    stdio: "ignore",
  });
  return child;
}

async function waitHttp(url, ok, timeoutMs = 10_000) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      const body = await res.json();
      if (Boolean(body.omp?.resolved) === ok) return;
    } catch {}
    if (Date.now() - start > timeoutMs) throw new Error(`bridge never became ${ok ? "healthy" : "unhealthy"}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const missing = startBridge(true);
await waitHttp(`http://127.0.0.1:${PORT}/api/health`, false);
console.log("STEP0 missing bridge up");

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://127.0.0.1:5173/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
console.log("STEP1 guide shown:", (await page.locator("text=未检测到 oh-my-pi").count()) > 0);

// Swap bridges underneath the open page.
missing.kill();
const healthy = startBridge(false);
await waitHttp(`http://127.0.0.1:${PORT}/api/health`, true);
console.log("STEP2 healthy bridge up");

// Click refresh; the store should flip health → gate releases → chat mounts.
const poll = setInterval(() => {
  page.locator("button", { hasText: "重新检测" }).click({ timeout: 2000 }).catch(() => {});
}, 2000);
try {
  await page.locator("text=New chat").waitFor({ timeout: 30_000 });
  console.log("STEP3 recovered to chat ✓");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "shots/guide-recovered.png" });
} catch {
  console.log("STEP3 recovery FAILED");
  await page.screenshot({ path: "shots/guide-recovery-failed.png" });
}
clearInterval(poll);
healthy.kill();
await browser.close();
process.exit(0);
