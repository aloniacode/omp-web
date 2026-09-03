/**
 * The bridge's HTTP application: origin guard, /api routes, static dist/.
 * Extracted from bridge.mjs so routing is unit-testable — everything
 * connection-specific arrives via the ctx object:
 *
 * - ompBin:            binary name probed on PATH by /api/health
 * - getDefaultCwd / setDefaultCwd: the bridge-wide agent working directory
 * - connections:       Map<id, { cwd, child }> of live browser connections
 * - children:          Set of RpcChild instances (legacy dispose-all path)
 * - sessionsDir:       ~/.omp/agent/sessions
 * - maxUplinkBytes:    transport limit shared with /api/scratch
 * - distDir:           built frontend served as static files
 * - checkAuth:         (req, url) => boolean for the bridge access token;
 *                      absent means auth is disabled (tests, OMP_WEB_TOKEN=off)
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { isAllowedOrigin } from "./origin-guard.mjs";
import { searchFiles } from "./workspace-files.mjs";
import { listSkills } from "./skills.mjs";
import { listSessions, deleteSessionFile } from "./session-store.mjs";
import { listBranches, checkoutBranch } from "./git-branches.mjs";
import { writeScratchFile } from "./scratch.mjs";
import { whichExecutable } from "./fs-browse.mjs";
import { pickFolder } from "./folder-dialog.mjs";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

export function createHttpApp(ctx) {
  return async function handle(req, res) {
    // Any web page can send no-preflight requests at localhost; judge Origin
    // before touching state (read-only GETs would be safe, the rest are not).
    if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
      return sendJson(res, 403, { error: "cross-origin request rejected" });
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    // The access token gates every /api route (static assets stay open so the
    // token-entry page can load). Origin was already judged above.
    if (url.pathname.startsWith("/api/") && ctx.checkAuth && !ctx.checkAuth(req, url)) {
      return sendJson(res, 401, {
        error: "unauthorized — open the bridge URL with ?token=<access token>, or send the x-omp-web-token header",
        authRequired: true,
      });
    }
    // cwd-scoped endpoints resolve against the calling connection's directory
    // when the browser announces it (each tab can sit in a different project).
    const connectionCwd = () => {
      const id = req.headers["x-omp-web-connection"];
      if (typeof id === "string" && ctx.connections.has(id)) return ctx.connections.get(id).cwd;
      return ctx.getDefaultCwd();
    };
    try {
      if (url.pathname === "/api/health") {
        const found = whichExecutable(ctx.ompBin);
        return sendJson(res, 200, {
          ok: true,
          omp: { bin: ctx.ompBin, resolved: found, cwd: ctx.getDefaultCwd() },
        });
      }
      if (url.pathname === "/api/files" && req.method === "GET") {
        const query = url.searchParams.get("q") ?? "";
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 24) || 24, 50);
        return sendJson(res, 200, { files: await searchFiles(connectionCwd(), query, limit) });
      }
      if (url.pathname === "/api/skills" && req.method === "GET") {
        return sendJson(res, 200, { skills: await listSkills(connectionCwd()) });
      }
      if (url.pathname === "/api/branches" && req.method === "GET") {
        return sendJson(res, 200, await listBranches(connectionCwd()));
      }
      if (url.pathname === "/api/branches" && req.method === "POST") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) return sendJson(res, 400, { error: "missing branch name" });
        return sendJson(res, 200, await checkoutBranch(connectionCwd(), name, body.create === true));
      }
      if (url.pathname === "/api/scratch" && req.method === "POST") {
        // Reject oversized uploads before buffering them.
        const declared = Number(req.headers["content-length"] ?? 0);
        if (Number.isFinite(declared) && declared > ctx.maxUplinkBytes + 1024) {
          return sendJson(res, 413, { error: "scratch content exceeds the uplink cap" });
        }
        const body = await readJsonBody(req);
        if (Buffer.byteLength(String(body.text ?? ""), "utf8") > ctx.maxUplinkBytes) {
          return sendJson(res, 413, { error: "scratch content exceeds the uplink cap" });
        }
        return sendJson(res, 200, await writeScratchFile(connectionCwd(), body.text));
      }
      if (url.pathname === "/api/sessions" && req.method === "GET") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 200);
        const scope = url.searchParams.get("scope") === "bucket" ? "bucket" : "all";
        return sendJson(res, 200, {
          sessions: await listSessions(ctx.sessionsDir, { cwd: connectionCwd(), limit, scope }),
        });
      }
      if (url.pathname === "/api/sessions" && req.method === "DELETE") {
        const target = url.searchParams.get("path") ?? (await readJsonBody(req)).path;
        if (!target) return sendJson(res, 400, { error: "missing path" });
        return sendJson(res, 200, await deleteSessionFile(ctx.sessionsDir, target));
      }
      if (url.pathname === "/api/projects" && req.method === "GET") {
        // Distinct session cwds, plus the calling connection's working directory.
        const sessions = await listSessions(ctx.sessionsDir, { limit: 200 });
        const byCwd = new Map();
        for (const session of sessions) {
          if (!session.cwd) continue;
          const entry = byCwd.get(session.cwd) ?? { cwd: session.cwd, sessions: 0, lastUsedMs: 0 };
          entry.sessions += 1;
          entry.lastUsedMs = Math.max(entry.lastUsedMs, session.mtimeMs);
          byCwd.set(session.cwd, entry);
        }
        const connCwd = connectionCwd();
        const projects = [...byCwd.values()].sort((a, b) => b.lastUsedMs - a.lastUsedMs);
        if (![...byCwd.keys()].some((cwd) => path.resolve(cwd) === path.resolve(connCwd))) {
          projects.unshift({ cwd: connCwd, sessions: 0, lastUsedMs: 0 });
        }
        return sendJson(res, 200, { projects, current: connCwd });
      }
      if (url.pathname === "/api/pick-folder" && req.method === "POST") {
        // Opens the device's native folder dialog; injectable for tests.
        return sendJson(res, 200, await (ctx.pickFolder ?? pickFolder)());
      }
      if (url.pathname === "/api/cwd" && req.method === "POST") {
        const body = await readJsonBody(req);
        const cwd = typeof body.cwd === "string" ? path.resolve(body.cwd) : "";
        if (!cwd) return sendJson(res, 400, { error: "missing cwd" });
        let stat;
        try {
          stat = await fsp.stat(cwd);
        } catch {
          return sendJson(res, 400, { error: `directory not found: ${cwd}` });
        }
        if (!stat.isDirectory()) return sendJson(res, 400, { error: `not a directory: ${cwd}` });
        // Remember the latest choice as the default for fresh connections.
        const globalChanged = path.resolve(ctx.getDefaultCwd()) !== cwd;
        ctx.setDefaultCwd(cwd);
        const headerId = req.headers["x-omp-web-connection"];
        const connection = typeof headerId === "string" ? ctx.connections.get(headerId) : undefined;
        if (connection) {
          // Connection-scoped switch: only this tab's agent respawns; other
          // connections keep running in their own directory.
          const connectionChanged = path.resolve(connection.cwd) !== cwd;
          connection.cwd = cwd;
          if (connectionChanged && connection.child) connection.child.dispose(true);
          return sendJson(res, 200, { ok: true, cwd, changed: connectionChanged });
        }
        // Legacy callers (no connection id): recycle every agent child.
        if (!globalChanged) return sendJson(res, 200, { ok: true, cwd, changed: false });
        for (const child of ctx.children) child.dispose(true);
        return sendJson(res, 200, { ok: true, cwd, changed: true });
      }
      if (url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: "unknown endpoint" });
      }

      // Static dist/ (production mode: `pnpm build` then `pnpm start`).
      let filePath = path.join(ctx.distDir, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
      if (!filePath.startsWith(ctx.distDir + path.sep) && filePath !== path.join(ctx.distDir, "index.html")) {
        filePath = path.join(ctx.distDir, "index.html");
      }
      let data;
      try {
        data = await fsp.readFile(filePath);
      } catch {
        filePath = path.join(ctx.distDir, "index.html");
        data = await fsp.readFile(filePath).catch(() => null);
      }
      if (!data) return sendJson(res, 404, { error: "not built — run `pnpm build`" });
      res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
      res.end(data);
    } catch (err) {
      sendJson(res, err.status ?? 500, { error: err.message });
    }
  };
}
