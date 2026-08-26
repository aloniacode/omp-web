import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});

// 1) Defaults: fresh profile → dark + graphite
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const defaults = await page.evaluate(() => ({
  dark: document.documentElement.classList.contains("dark"),
  accent: document.documentElement.dataset.accent ?? "(unset=graphite)",
}));
console.log("defaults:", JSON.stringify(defaults));
await page.screenshot({ path: "shots/theme-default-dark.png" });
console.log("captured theme-default-dark.png");

// 2) Accent presets: switch to violet then emerald via localStorage + reload
for (const accent of ["violet", "emerald"]) {
  await page.evaluate((id) => {
    localStorage.setItem("omp-web.accent", id);
  }, accent);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const applied = await page.evaluate(() => document.documentElement.dataset.accent);
  console.log(`accent=${applied}`);
  await page.screenshot({ path: `shots/theme-accent-${accent}.png` });
  console.log(`captured theme-accent-${accent}.png`);
}

await page.close();
await browser.close();
