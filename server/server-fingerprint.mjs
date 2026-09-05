/**
 * Fingerprint of the server code: `name:size:mtime` of every server/*.mjs
 * module. The vite dev plugin computes the same digest and compares it with
 * the running bridge's (exposed via /api/health), so a quick dev restart
 * never silently reuses a bridge that predates server-code changes.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

export function computeServerFingerprint(dir = SERVER_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => {
      const stat = statSync(path.join(dir, name));
      return `${name}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    })
    .join("|");
}
