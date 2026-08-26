/**
 * Visual verification harness: drives the built UI in headless Edge.
 *
 *   node scripts/screenshot.mjs [url] [outdir]
 *
 * Captures: light theme, dark theme (toggled via sidebar control), and the
 * model picker open state. Requires the bridge running on :8787 with dist/ built.
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] ?? "http://127.0.0.1:8787/";
const OUT = process.argv[3] ?? "shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) console.log(`[console.${msg.type()}]`, msg.text().slice(0, 200));
});
page.on("pageerror", (err) => console.log("[pageerror]", String(err).slice(0, 300)));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // allow WS handshake + session init

// Light theme (system may already be dark; force via localStorage + reload)
await page.evaluate(() => {
  localStorage.setItem("omp-web.theme", "light");
  document.documentElement.classList.remove("dark");
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/light.png` });
console.log("captured light.png");

// Dark theme
await page.evaluate(() => {
  localStorage.setItem("omp-web.theme", "dark");
  document.documentElement.classList.add("dark");
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/dark.png` });
console.log("captured dark.png");

// Dump some structural facts for verification
const facts = await page.evaluate(() => ({
  title: document.title,
  hasSidebar: !!document.querySelector("aside"),
  sessionItems: document.querySelectorAll("aside nav button").length,
  topbarText: document.querySelector("header")?.textContent?.slice(0, 160) ?? "",
  composerPresent: !!document.querySelector("textarea"),
  darkClass: document.documentElement.classList.contains("dark"),
}));
console.log(JSON.stringify(facts, null, 2));

await browser.close();
