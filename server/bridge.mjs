/**
 * omp-web bridge.
 *
 * Owns an `omp --mode rpc` child process per WebSocket connection and bridges
 * newline-delimited JSON-RPC frames (stdio) <-> WebSocket JSON frames.
 *
 * Responsibilities (communication layer only — no agent functionality):
 * - Protocol v2 negotiation + lossless `rpc_chunk` reassembly so browsers
 *   always receive whole JSON frames regardless of the 1 MiB stdout cap.
 * - REST endpoints: /api/health, /api/sessions (list/delete), static dist/.
 *
 * Env: PORT (8787), OMP_BIN ("omp"), OMP_CWD (process.cwd()), OMP_ARGS (extra CLI args).
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { parseSessionPrefix, bucketNamesForCwd } from "./session-meta.mjs";
import { FrameAssembler } from "./rpc-frame.mjs";
import { listBranches, checkoutBranch } from "./git-branches.mjs";
import { writeScratchFile } from "./scratch.mjs";
import { NEGOTIATED_MAX_REASSEMBLED_BYTES, PROTOCOL_REQUEST_ID, PROTOCOL_VERSION, hasType } from "@omp-web/protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRA_OMP_ARGS = process.env.OMP_ARGS ? process.env.OMP_ARGS.split(" ").filter(Boolean) : [];
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const OMP_BIN = process.env.OMP_BIN ?? "omp";
/** Agent working directory; switchable at runtime via POST /api/cwd. */
let ompCwd = process.env.OMP_CWD ?? process.cwd();
const DIST_DIR = path.join(__dirname, "..", "dist");
const MAX_LINE_BYTES = 128 * 1024 * 1024;
/** Uplink guard: browser -> agent stdin frames above this are rejected.
 *  Generous default: image-bearing prompt frames are base64-heavy. */
const UPLINK_MB = Number(process.env.OMP_MAX_UPLINK_MB ?? 32);
const MAX_UPLINK_BYTES = (Number.isFinite(UPLINK_MB) && UPLINK_MB > 0 ? UPLINK_MB : 32) * 1024 * 1024;

// ---------------------------------------------------------------------------
// Session listing (~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl)
// ---------------------------------------------------------------------------

const SESSIONS_DIR = path.join(os.homedir(), ".omp", "agent", "sessions");

/** Bounded workspace file search for the composer's @-mention popup. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

async function searchFiles(query, limit = 24) {
  const results = [];
  const needle = query.toLowerCase();
  async function walk(dir, rel, depth) {
    if (depth > 4 || results.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1);
      } else if (!needle || relPath.toLowerCase().includes(needle)) {
        results.push(relPath);
      }
    }
  }
  await walk(ompCwd, "", 0);
  return results;
}

/** Skills from the global agent dir plus the project's .omp/skills. */
async function listSkills() {
  const roots = [
    { dir: path.join(os.homedir(), ".omp", "agent", "skills"), source: "global" },
    { dir: path.join(ompCwd, ".omp", "skills"), source: "project" },
  ];
  const out = [];
  for (const { dir, source } of roots) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = { name: entry.name, description: "", source };
      try {
        const raw = await fsp.readFile(path.join(dir, entry.name, "SKILL.md"), "utf8");
        const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (frontmatter) {
          const name = frontmatter[1].match(/^name:\s*(.+)$/m);
          const description = frontmatter[1].match(/^description:\s*(.+)$/m);
          if (name) meta.name = name[1].trim();
          if (description) meta.description = description[1].trim().slice(0, 120);
        }
      } catch {
        // SKILL.md missing — keep directory name
      }
      out.push(meta);
    }
  }
  return out;
}

function isBucketForCwd(bucketName) {
  return bucketNamesForCwd(ompCwd).has(bucketName);
}

async function listSessions({ limit = 50, scope = "all" } = {}) {
  let buckets;
  try {
    buckets = await fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const dirent of buckets) {
    if (!dirent.isDirectory()) continue;
    if (scope !== "all" && !isBucketForCwd(dirent.name)) continue;
    let files;
    try {
      files = await fsp.readdir(path.join(SESSIONS_DIR, dirent.name));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      candidates.push(path.join(SESSIONS_DIR, dirent.name, file));
    }
  }

  const withStats = await Promise.all(
    candidates.map(async (p) => {
      try {
        return { p, stat: await fsp.stat(p) };
      } catch {
        return null;
      }
    }),
  );
  withStats.sort((a, b) => (b?.stat.mtimeMs ?? 0) - (a?.stat.mtimeMs ?? 0));

  const out = [];
  for (const { p, stat } of withStats) {
    if (out.length >= limit) break;
    if (!stat) continue;
    try {
      const handle = await fsp.open(p, "r");
      try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
        const parsed = parseSessionPrefix(p, buffer.subarray(0, bytesRead), stat);
        if (parsed) out.push(parsed);
      } finally {
        await handle.close();
      }
    } catch {
      // unreadable file — skip
    }
  }
  return out;
}

async function deleteSessionFile(requestedPath) {
  const resolved = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(SESSIONS_DIR);
  if (!resolved.startsWith(resolvedRoot + path.sep) || !resolved.endsWith(".jsonl")) {
    throw Object.assign(new Error("path outside sessions directory"), { status: 400 });
  }
  await fsp.unlink(resolved);
  return { deleted: resolved };
}

// ---------------------------------------------------------------------------
// RPC child process with protocol v2 chunk reassembly
// ---------------------------------------------------------------------------

class RpcChild {
  constructor(onFrame, onExit, log) {
    this.onFrame = onFrame;
    this.onExit = onExit;
    this.log = log;
    this.assembler = new FrameAssembler();
    this.exited = false;
    this.stderrTail = [];

    this.child = spawn(OMP_BIN, ["--mode", "rpc", "--continue", ...EXTRA_OMP_ARGS], {
      cwd: ompCwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.buffer = Buffer.alloc(0);
    this.child.stdout.on("data", (chunk) => this.#consumeStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderrTail.push(chunk.toString("utf8"));
      if (this.stderrTail.length > 200) this.stderrTail.shift();
    });
    this.child.once("exit", (code, signal) => {
      this.exited = true;
      this.onExit(code, signal);
    });
    this.child.once("error", (err) => {
      this.exited = true;
      this.log(`spawn error: ${err.message}`);
      this.onFrame({
        type: "bridge_event",
        event: "spawn_error",
        error: err.message,
        hint: `Set OMP_BIN to the omp binary path (looked for "${OMP_BIN}")`,
      });
      // Dead child: drop the socket so the browser's retry loop re-attempts
      // the spawn (e.g. right after the user installs omp).
      this.onExit(null, "SPAWN_ERROR");
    });
  }

  get pid() {
    return this.child.pid;
  }

  /** Frame flowing agent -> browser after chunk reassembly. */
  #emit(obj) {
    if (obj.type === "ready") {
      const versions = obj.supportedProtocolVersions ?? [obj.protocolVersion ?? 1];
      if (versions.includes(PROTOCOL_VERSION)) {
        // Opt into lossless transport before any oversized frame can occur.
        this.sendDown({ id: PROTOCOL_REQUEST_ID, type: "negotiate_protocol", protocolVersion: PROTOCOL_VERSION });
      }
    }
    if (obj.id === PROTOCOL_REQUEST_ID && obj.command === "negotiate_protocol") {
      if (obj.success && obj.data?.protocolVersion === PROTOCOL_VERSION) {
        this.maxReassembled = Math.min(this.maxReassembled, NEGOTIATED_MAX_REASSEMBLED_BYTES);
        this.log("negotiated protocol v2");
      }
    }
    this.onFrame(obj);
  }

  #consumeStdout(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (;;) {
      const nl = this.buffer.indexOf(0x0a);
      if (nl === -1) break;
      const line = this.buffer.subarray(0, nl);
      this.buffer = this.buffer.subarray(nl + 1);
      if (line.length === 0) continue;
      if (line.length > MAX_LINE_BYTES) {
        this.#chunkFail(`stdout line exceeds ${MAX_LINE_BYTES} bytes`);
        continue;
      }
      let obj;
      try {
        obj = JSON.parse(line.toString("utf8"));
      } catch {
        this.#chunkFail("malformed stdout frame");
        continue;
      }
      const res = this.assembler.feed(obj);
      if (res.error) {
        this.#chunkFail(res.error);
        continue;
      }
      if (res.output !== null && res.output !== undefined) this.#emit(res.output);
    }
  }

  #chunkFail(message) {
    this.log(`frame error: ${message}`);
    this.onFrame({ type: "bridge_event", event: "frame_error", error: message });
    return false;
  }

  /** Browser/bridge -> agent stdin. */
  sendDown(obj) {
    if (this.exited || this.child.killed) return false;
    this.child.stdin.write(JSON.stringify(obj) + "\n");
    return true;
  }

  dispose(graceful = true) {
    clearTimeout(this.killTimer);
    if (this.exited) return;
    if (graceful) {
      // Per protocol: closing stdin drains accepted work, disposes, exits 0.
      this.child.stdin.end();
      this.killTimer = setTimeout(() => this.dispose(false), 5000);
    } else {
      this.child.kill("SIGKILL");
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP + WS wiring
// ---------------------------------------------------------------------------

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

/**
 * Top-level listing for the project picker's filesystem browser.
 * Windows: available drive letters. POSIX: home + common roots.
 */
async function fsRoots() {
  const entries = [];
  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        await fsp.access(drive);
        entries.push({ name: drive, path: drive });
      } catch {}
    }
  } else {
    for (const dir of [os.homedir(), "/"]) {
      try {
        const stat = await fsp.stat(dir);
        if (stat.isDirectory()) entries.push({ name: dir, path: dir });
      } catch {}
    }
  }
  return { path: "", parent: null, entries };
}

function whichOmp() {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".exe").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, OMP_BIN.endsWith(".exe") ? OMP_BIN : OMP_BIN + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/health") {
      const found = whichOmp();
      return sendJson(res, 200, {
        ok: true,
        omp: { bin: OMP_BIN, resolved: found, cwd: ompCwd },
      });
    }
    if (url.pathname === "/api/files" && req.method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 24) || 24, 50);
      return sendJson(res, 200, { files: await searchFiles(query, limit) });
    }
    if (url.pathname === "/api/skills" && req.method === "GET") {
      return sendJson(res, 200, { skills: await listSkills() });
    }
    if (url.pathname === "/api/branches" && req.method === "GET") {
      return sendJson(res, 200, await listBranches(ompCwd));
    }
    if (url.pathname === "/api/branches" && req.method === "POST") {
      const body = await readJsonBody(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return sendJson(res, 400, { error: "missing branch name" });
      return sendJson(res, 200, await checkoutBranch(ompCwd, name, body.create === true));
    }
    if (url.pathname === "/api/scratch" && req.method === "POST") {
      // Reject oversized uploads before buffering them.
      const declared = Number(req.headers["content-length"] ?? 0);
      if (Number.isFinite(declared) && declared > MAX_UPLINK_BYTES + 1024) {
        return sendJson(res, 413, { error: "scratch content exceeds the uplink cap" });
      }
      const body = await readJsonBody(req);
      if (Buffer.byteLength(String(body.text ?? ""), "utf8") > MAX_UPLINK_BYTES) {
        return sendJson(res, 413, { error: "scratch content exceeds the uplink cap" });
      }
      return sendJson(res, 200, await writeScratchFile(ompCwd, body.text));
    }
    if (url.pathname === "/api/sessions" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 60) || 60, 200);
      const scope = url.searchParams.get("scope") === "bucket" ? "bucket" : "all";
      return sendJson(res, 200, { sessions: await listSessions({ limit, scope }) });
    }
    if (url.pathname === "/api/sessions" && req.method === "DELETE") {
      const target = url.searchParams.get("path") ?? (await readJsonBody(req)).path;
      if (!target) return sendJson(res, 400, { error: "missing path" });
      return sendJson(res, 200, await deleteSessionFile(target));
    }
    if (url.pathname === "/api/projects" && req.method === "GET") {
      // Distinct session cwds, plus the current working directory.
      const sessions = await listSessions({ limit: 200 });
      const byCwd = new Map();
      for (const session of sessions) {
        if (!session.cwd) continue;
        const entry = byCwd.get(session.cwd) ?? { cwd: session.cwd, sessions: 0, lastUsedMs: 0 };
        entry.sessions += 1;
        entry.lastUsedMs = Math.max(entry.lastUsedMs, session.mtimeMs);
        byCwd.set(session.cwd, entry);
      }
      const projects = [...byCwd.values()].sort((a, b) => b.lastUsedMs - a.lastUsedMs);
      if (![...byCwd.keys()].some((cwd) => path.resolve(cwd) === path.resolve(ompCwd))) {
        projects.unshift({ cwd: ompCwd, sessions: 0, lastUsedMs: 0 });
      }
      return sendJson(res, 200, { projects, current: ompCwd });
    }
    if (url.pathname === "/api/fs" && req.method === "GET") {
      const requested = (url.searchParams.get("path") ?? "").trim();
      if (!requested) return sendJson(res, 200, await fsRoots());
      const dir = path.resolve(requested);
      let stat;
      try {
        stat = await fsp.stat(dir);
      } catch {
        return sendJson(res, 400, { error: `directory not found: ${dir}` });
      }
      if (!stat.isDirectory()) return sendJson(res, 400, { error: `not a directory: ${dir}` });
      const entries = [];
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          entries.push({ name: entry.name, path: path.join(dir, entry.name) });
        }
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      const parent = path.dirname(dir);
      return sendJson(res, 200, {
        path: dir,
        parent: parent === dir ? null : parent,
        entries,
      });
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
      if (path.resolve(ompCwd) === cwd) return sendJson(res, 200, { ok: true, cwd: ompCwd, changed: false });
      ompCwd = cwd;
      // Dispose agent children so the browser's reconnect respawns them in
      // the new project directory.
      for (const child of children) child.dispose(true);
      console.log(`[bridge] cwd switched to ${ompCwd}`);
      return sendJson(res, 200, { ok: true, cwd: ompCwd, changed: true });
    }
    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: "unknown endpoint" });
    }

    // Static dist/ (production mode: `npm run build` then `npm start`).
    let filePath = path.join(DIST_DIR, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!filePath.startsWith(DIST_DIR)) filePath = path.join(DIST_DIR, "index.html");
    let data;
    try {
      data = await fsp.readFile(filePath);
    } catch {
      filePath = path.join(DIST_DIR, "index.html");
      data = await fsp.readFile(filePath).catch(() => null);
    }
    if (!data) return sendJson(res, 404, { error: "not built — run `npm run build`" });
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    sendJson(res, err.status ?? 500, { error: err.message });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[bridge] Port ${PORT} is already in use.`);
    console.error("[bridge] Another omp-web bridge is probably running - stop it first:");
    console.error(`[bridge]   Windows: netstat -ano | findstr :${PORT}   then: taskkill /PID <pid> /F`);
    console.error("[bridge]   Or pick another port: PORT=8788 pnpm dev");
    process.exit(1);
  }
  throw err;
});

const wss = new WebSocketServer({ noServer: true });
const children = new Set();

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  console.log("[bridge] ws connected — spawning agent");
  let closed = false;

  const child = new RpcChild(
    (frame) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    },
    (code, signal) => {
      if (closed) return;
      try {
        ws.send(JSON.stringify({ type: "bridge_event", event: "agent_exit", code, signal }));
      } catch {}
      ws.close(1011, "agent exited");
    },
    (msg) => console.log(`[bridge:${child.pid}] ${msg}`),
  );

  if (child.pid) children.add(child);

  ws.on("message", (raw) => {
    if (raw.length > MAX_UPLINK_BYTES) {
      // The RPC stdin pipe has no chunking on the uplink: reject absurd
      // payloads instead of letting them stall the agent child.
      ws.send(
        JSON.stringify({
          type: "bridge_event",
          event: "frame_error",
          error: `uplink frame exceeds ${Math.floor(MAX_UPLINK_BYTES / 1024 / 1024)} MiB cap`,
        }),
      );
      return;
    }
    let obj;
    try {
      obj = JSON.parse(raw.toString("utf8"));
    } catch {
      ws.send(JSON.stringify({ type: "bridge_event", event: "bad_frame", error: "not valid JSON" }));
      return;
    }
    if (hasType(obj)) {
      child.sendDown(obj);
    } else {
      ws.send(JSON.stringify({ type: "bridge_event", event: "bad_frame", error: "missing type field" }));
    }
  });

  const heartbeat = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.ping();
  }, 30_000);

  ws.on("close", () => {
    clearInterval(heartbeat);
    closed = true;
    if (child.pid) children.delete(child);
    console.log(`[bridge] ws closed — disposing agent ${child.pid ?? "(unspawned)"}`);
    child.dispose(true);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] omp binary: ${whichOmp() ?? `"${OMP_BIN}" (not found on PATH)`}`);
  console.log(`[bridge] agent cwd:  ${ompCwd}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const child of children) child.dispose(true);
    setTimeout(() => process.exit(0), 1500);
  });
}

/**
 * Parent watchdog: when spawned by the vite dev server (OMP_PARENT_PID),
 * exit if the parent dies so a hard-killed vite never leaves an orphaned
 * bridge holding the port.
 */
const parentPid = Number(process.env.OMP_PARENT_PID ?? 0);
if (parentPid > 0) {
  const watchdog = setInterval(() => {
    let alive = true;
    try {
      process.kill(parentPid, 0);
    } catch {
      alive = false;
    }
    if (!alive) {
      clearInterval(watchdog);
      for (const child of children) child.dispose(true);
      setTimeout(() => process.exit(0), 1000);
    }
  }, 2000);
  watchdog.unref();
}
