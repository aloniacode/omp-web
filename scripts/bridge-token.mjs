/**
 * Bridge access token for scripts — same resolution as server/auth-token.mjs
 * (OMP_WEB_TOKEN wins unless "off", then the persisted token file), but
 * strictly read-only: scripts never mint or write the token.
 */
import fs from "node:fs";
import { AUTH_OFF, TOKEN_FILE } from "../server/auth-token.mjs";

export function resolveScriptToken() {
  const configured = (process.env.OMP_WEB_TOKEN ?? "").trim();
  if (configured) return AUTH_OFF.test(configured) ? "" : configured;
  try {
    return fs.readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    if (!process.env.OMP_WEB_TOKEN) {
      console.warn("[script] no bridge access token found — set OMP_WEB_TOKEN or check ~/.omp/web-bridge-token");
    }
    return "";
  }
}

/** Append the access token to a bridge URL as ?token= (no-op when disabled). */
export function withToken(url) {
  const token = resolveScriptToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}
