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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRA_OMP_ARGS = process.env.OMP_ARGS ? process.env.OMP_ARGS.split(" ").filter(Boolean) : [];
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const OMP_BIN = process.env.OMP_BIN ?? "omp";
const OMP_CWD = process.env.OMP_CWD ?? process.cwd();
const DIST_DIR = path.join(__dirname, "..", "dist");
const MAX_LINE_BYTES = 128 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Session listing (~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl)
// ---------------------------------------------------------------------------

const SESSIONS_DIR = path.join(os.homedir(), ".omp", "agent", "sessions");

function sanitizeText(text) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function userTextFromContent(content) {
  if (typeof content === "string") return sanitizeText(content);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return sanitizeText(block.text);
      }
    }
  }
  return "";
}

/**
 * Parse a session JSONL prefix (4 KiB is enough: fixed-width title slot +
 * header + earliest entries). Returns lightweight metadata or null.
 */
function parseSessionPrefix(filePath, buf, stat) {
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  if (lines.length > 1) lines.pop(); // drop trailing partial line

  let header = null;
  let slotTitle = null;
  let preview = "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;

    if (entry.type === "title") {
      if (typeof entry.title === "string" && entry.title.trim()) slotTitle = entry.title.trim();
      continue;
    }
    if (entry.type === "session" && !header) {
      header = {
        id: typeof entry.id === "string" ? entry.id : path.basename(filePath, ".jsonl"),
        timestamp: entry.timestamp ?? null,
        cwd: typeof entry.cwd === "string" ? entry.cwd : null,
        title: typeof entry.title === "string" ? entry.title.trim() : "",
        titleSource: entry.titleSource ?? null,
      };
    }
    if (!preview && entry.type === "message" && entry.message?.role === "user") {
      const text0 = userTextFromContent(entry.message.content);
      if (text0) preview = text0.slice(0, 140);
    }
    if (header && preview) break;
  }

  const title = slotTitle ?? header?.title ?? "";
  return {
    path: filePath,
    id: header?.id ?? path.basename(filePath, ".jsonl"),
    cwd: header?.cwd ?? null,
    title: title || preview || null,
    titleIsAuto: !(slotTitle || (header?.title && header.titleSource === "user")) && Boolean(title),
    preview,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    startedAt: header?.timestamp ?? null,
  };
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

/**
 * Encoded-cwd bucket names per docs/session.md: `--<encoded-absolute>--` where
 * every `\`, `/` and `:` becomes `-`, or `-<relative>` for directories under
 * the home directory.
 */
function bucketNamesForCwd(cwd) {
  const names = new Set();
  const absolute = "--" + [...cwd].map((c) => (/[\\/:]/.test(c) ? "-" : c)).join("") + "--";
  names.add(absolute);
  const rel = path.relative(os.homedir(), cwd);
  if (rel && !rel.startsWith("..")) {
    const homeRel = "-" + [...rel].map((c) => (/[\\/:]/.test(c) ? "-" : c)).join("");
    names.add(homeRel);
  }
  return names;
}

function isBucketForCwd(bucketName) {
  return bucketNamesForCwd(OMP_CWD).has(bucketName);
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
    this.maxReassembled = 64 * 1024 * 1024;
    this.pendingChunk = null;
    this.exited = false;
    this.stderrTail = [];

    this.child = spawn(OMP_BIN, ["--mode", "rpc", "--continue", ...EXTRA_OMP_ARGS], {
      cwd: OMP_CWD,
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
      if (versions.includes(2)) {
        // Opt into lossless transport before any oversized frame can occur.
        this.sendDown({ id: "protocol-1", type: "negotiate_protocol", protocolVersion: 2 });
      }
    }
    if (obj.id === "protocol-1" && obj.command === "negotiate_protocol") {
      if (obj.success && obj.data?.protocolVersion === 2) {
        this.maxReassembled = Math.min(this.maxReassembled, 512 * 1024 * 1024);
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
      if (obj?.type === "rpc_chunk") {
        if (!this.#acceptChunk(obj)) continue;
      } else {
        this.#emit(obj);
      }
    }
  }

  /**
   * Accumulate `rpc_chunk` sequences; returns true when a full logical frame
   * was reassembled (already emitted). Mirrors omp's RpcFrameDecoder rules:
   * same chunkId, strictly ordered indices, no interleaving, byteLength checks.
   */
  #acceptChunk(frame) {
    const { chunkId, index, count, byteLength, data } = frame;
    if (
      typeof chunkId !== "string" ||
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      count < 1 ||
      index < 0 ||
      !Number.isInteger(byteLength) ||
      typeof data !== "string"
    ) {
      return this.#chunkFail("malformed rpc_chunk fields");
    }
    if (this.pendingChunk && this.pendingChunk.chunkId !== chunkId) {
      return this.#chunkFail(`interleaved chunk sequence (${this.pendingChunk.chunkId} vs ${chunkId})`);
    }
    if (!this.pendingChunk) {
      if (index !== 0) return this.#chunkFail(`chunk sequence starts at index ${index}`);
      if (byteLength > this.maxReassembled) {
        return this.#chunkFail(`reassembled frame ${byteLength} exceeds limit ${this.maxReassembled}`);
      }
      this.pendingChunk = { chunkId, count, byteLength, parts: [] };
    } else if (
      count !== this.pendingChunk.count ||
      byteLength !== this.pendingChunk.byteLength
    ) {
      return this.#chunkFail("chunk metadata mismatch within sequence");
    }
    if (index !== this.pendingChunk.parts.length) {
      return this.#chunkFail(`out-of-order chunk index ${index}, expected ${this.pendingChunk.parts.length}`);
    }
    this.pendingChunk.parts.push(Buffer.from(data, "base64"));

    if (this.pendingChunk.parts.length < count) return false;

    const { byteLength: expected, parts } = this.pendingChunk;
    this.pendingChunk = null;
    const buf = Buffer.concat(parts);
    if (buf.length !== expected) return this.#chunkFail(`reassembly size mismatch (${buf.length} != ${expected})`);
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const json = decoder.decode(buf);
      this.#emit(JSON.parse(json));
    } catch (err) {
      return this.#chunkFail(`reassembly decode failed: ${err.message}`);
    }
    return true;
  }

  #chunkFail(message) {
    this.pendingChunk = null;
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
        omp: { bin: OMP_BIN, resolved: found, cwd: OMP_CWD },
      });
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
    let obj;
    try {
      obj = JSON.parse(raw.toString("utf8"));
    } catch {
      ws.send(JSON.stringify({ type: "bridge_event", event: "bad_frame", error: "not valid JSON" }));
      return;
    }
    if (obj && typeof obj === "object" && typeof obj.type === "string") {
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
  console.log(`[bridge] agent cwd:  ${OMP_CWD}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const child of children) child.dispose(true);
    setTimeout(() => process.exit(0), 1500);
  });
}
