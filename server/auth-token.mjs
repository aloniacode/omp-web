/**
 * Bridge access token — the gate for /api routes and WebSocket upgrades.
 *
 * The bridge can drive the agent (prompts run bash) and run git, so binding
 * to loopback alone is not enough: any local process, and a DNS-rebinding
 * page (whose Origin matches its own Host), would reach an unauthenticated
 * bridge. A random token is generated on first start and persisted next to
 * the agent state; browsers present it as `?token=` on the WebSocket and the
 * `x-omp-web-token` header on /api calls (the page consumes `?token=` from
 * the URL once and keeps it in localStorage).
 *
 * Env: OMP_WEB_TOKEN — a fixed token, or "off" to disable auth entirely
 * (single-user machines that know what they are doing).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const TOKEN_FILE = path.join(os.homedir(), ".omp", "web-bridge-token");
export const AUTH_OFF = /^(?:0|false|off|none)$/i;

/**
 * Resolve the active access token. `source` is "env" | "file" | "disabled";
 * token is null only when auth is explicitly disabled.
 */
export function resolveBridgeToken(env = process.env, tokenFile = TOKEN_FILE) {
  const configured = (env.OMP_WEB_TOKEN ?? "").trim();
  if (configured) {
    if (AUTH_OFF.test(configured)) return { token: null, source: "disabled" };
    return { token: configured, source: "env" };
  }
  try {
    const existing = fs.readFileSync(tokenFile, "utf8").trim();
    if (existing) return { token: existing, source: "file" };
  } catch {
    // Missing or unreadable token file: fall through and mint a fresh one.
  }
  const token = randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  // mode 0o600 is a no-op on win32 — protection there comes from the default
  // %USERPROFILE% ACLs; keep it for the unix story.
  fs.writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  return { token, source: "file" };
}

/**
 * Timing-safe token comparison. Hashing first hides length differences
 * (timingSafeEqual throws on unequal lengths). A null expected token means
 * auth is disabled — everything is allowed.
 */
export function verifyToken(presented, expected) {
  if (expected === null || expected === undefined) return true;
  if (typeof presented !== "string" || presented.length === 0) return false;
  const hashed = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hashed(presented), hashed(expected));
}
