/**
 * omp-web bridge — composition root.
 *
 * Owns an `omp --mode rpc` child process per WebSocket connection and bridges
 * newline-delimited JSON-RPC frames (stdio) <-> WebSocket JSON frames. All
 * HTTP concerns (origin guard, /api routes, static dist/) live in
 * server/http-app.mjs; protocol frame reassembly in server/rpc-frame.mjs.
 *
 * Responsibilities here (communication layer only — no agent functionality):
 * - one agent child per WS connection, cwd-scoped per connection
 * - protocol v2 negotiation so oversized frames survive (chunk reassembly)
 * - uplink guards (frame size, envelope shape) and bridge_event error frames
 * - heartbeat, graceful dispose, vite parent watchdog
 *
 * Env: PORT (8787), HOST (127.0.0.1), OMP_BIN ("omp"), OMP_CWD (process.cwd()),
 * OMP_ARGS (extra CLI args), OMP_MAX_UPLINK_MB (32), OMP_WEB_TOKEN (access
 * token override; "off" disables auth — see server/auth-token.mjs).
 */
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { FrameAssembler } from "./rpc-frame.mjs";
import { isAllowedOrigin } from "./origin-guard.mjs";
import { createHttpApp } from "./http-app.mjs";
import { resolveBridgeToken, verifyToken, TOKEN_FILE } from "./auth-token.mjs";
import { NEGOTIATED_MAX_REASSEMBLED_BYTES, PROTOCOL_REQUEST_ID, PROTOCOL_VERSION, hasType } from "@omp-web/protocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRA_OMP_ARGS = process.env.OMP_ARGS ? process.env.OMP_ARGS.split(" ").filter(Boolean) : [];
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const OMP_BIN = process.env.OMP_BIN ?? "omp";
/**
 * Agent working directory. `ompCwd` is the default for fresh connections;
 * each connection can override it via POST /api/cwd (REST calls carry the
 * connection id), so one tab switching projects never disturbs another.
 */
let ompCwd = process.env.OMP_CWD ?? process.cwd();
const DIST_DIR = path.join(__dirname, "..", "dist");
const MAX_LINE_BYTES = 128 * 1024 * 1024;
/** Uplink guard: browser -> agent stdin frames above this are rejected.
 *  Generous default: image-bearing prompt frames are base64-heavy. */
const UPLINK_MB = Number(process.env.OMP_MAX_UPLINK_MB ?? 32);
const MAX_UPLINK_BYTES = (Number.isFinite(UPLINK_MB) && UPLINK_MB > 0 ? UPLINK_MB : 32) * 1024 * 1024;
const SESSIONS_DIR = path.join(os.homedir(), ".omp", "agent", "sessions");
const { token: ACCESS_TOKEN } = resolveBridgeToken();

/**
 * Access-token gate shared by /api routes and WS upgrades: the header wins
 * (fetch calls), the `?token=` query covers browsers (WebSocket can't set
 * custom headers).
 */
function isAuthorized(req, url) {
  const header = req.headers["x-omp-web-token"];
  return verifyToken(typeof header === "string" ? header : url.searchParams.get("token"), ACCESS_TOKEN);
}

// ---------------------------------------------------------------------------
// RPC child process with protocol v2 chunk reassembly
// ---------------------------------------------------------------------------

class RpcChild {
  constructor(cwd, onFrame, onExit, log) {
    this.onFrame = onFrame;
    this.onExit = onExit;
    this.log = log;
    // v1 default cap; raised on protocol v2 negotiation below.
    this.assembler = new FrameAssembler();
    this.exited = false;
    this.stderrTail = [];

    this.child = spawn(OMP_BIN, ["--mode", "rpc", "--continue", ...EXTRA_OMP_ARGS], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.buffer = Buffer.alloc(0);
    this.child.stdout.on("data", (chunk) => this.#consumeStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      // Raw stream chunks, not lines — a line may straddle two chunks. Capped
      // per chunk so a pathological writer can't balloon the exit frame.
      const text = chunk.toString("utf8");
      this.stderrTail.push(text.length > 4000 ? text.slice(-4000) : text);
      if (this.stderrTail.length > 200) this.stderrTail.shift();
    });
    this.child.once("exit", (code, signal) => {
      this.exited = true;
      // Console copy of the last stderr chunks: the UI toast is ephemeral,
      // the bridge log is where crash diagnostics survive.
      const tail = this.stderrTail.filter((line) => line.trim()).slice(-8);
      if (tail.length) this.log(`agent stderr (last chunks):\n${tail.join("").trimEnd()}`);
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
        this.assembler.maxBytes = Math.min(this.assembler.maxBytes, NEGOTIATED_MAX_REASSEMBLED_BYTES);
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
// HTTP (origin guard, /api routes, static dist/) — see server/http-app.mjs
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });
const children = new Set();
/** Active browser connections: id → { cwd, child } for connection-scoped cwd. */
const connections = new Map();

const handleHttp = createHttpApp({
  ompBin: OMP_BIN,
  getDefaultCwd: () => ompCwd,
  setDefaultCwd: (cwd) => {
    ompCwd = cwd;
  },
  connections,
  children,
  sessionsDir: SESSIONS_DIR,
  maxUplinkBytes: MAX_UPLINK_BYTES,
  distDir: DIST_DIR,
  checkAuth: isAuthorized,
});

const server = http.createServer((req, res) => {
  void handleHttp(req, res);
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

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  // WebSockets are not subject to CORS: without this check any page could
  // drive the agent (prompts run bash) and read everything it returns.
  if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
    socket.destroy();
    return;
  }
  if (!isAuthorized(req, url)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nconnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
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
  const connectionId = randomUUID();
  const connection = { cwd: ompCwd, child: null };
  connections.set(connectionId, connection);
  let closed = false;

  ws.send(JSON.stringify({ type: "bridge_event", event: "connection", id: connectionId }));

  const child = new RpcChild(
    connection.cwd,
    (frame) => {
      // bridge_event/connection is bridge→client only; a child (or extension)
      // must not rebind the tab's connection identity.
      if (frame.type === "bridge_event" && frame.event === "connection") return;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
    },
    (code, signal) => {
      if (closed) return;
      try {
        ws.send(
          JSON.stringify({
            type: "bridge_event",
            event: "agent_exit",
            code,
            signal,
            // Crash diagnostics: the agent's last stderr lines, surfaced in
            // the UI notice (a dead child's silence is otherwise undebuggable).
            stderrTail: child.stderrTail.slice(-8),
          }),
        );
      } catch {}
      ws.close(1011, "agent exited");
    },
    (msg) => console.log(`[bridge:${child.pid}] ${msg}`),
  );

  connection.child = child;
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
    connections.delete(connectionId);
    if (child.pid) children.delete(child);
    console.log(`[bridge] ws closed — disposing agent ${child.pid ?? "(unspawned)"}`);
    child.dispose(true);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] omp binary: ${OMP_BIN} (probed per /api/health)`);
  console.log(`[bridge] default agent cwd:  ${ompCwd}`);
  if (ACCESS_TOKEN) {
    console.log(`[bridge] access token: ${ACCESS_TOKEN}`);
    console.log(`[bridge]   persisted at ${TOKEN_FILE} — open http://${HOST}:${PORT}/?token=${ACCESS_TOKEN}`);
    console.log(`[bridge]   OMP_WEB_TOKEN=<token|off> to pin or disable auth`);
  } else {
    console.log("[bridge] access token: DISABLED (OMP_WEB_TOKEN=off) — any local process can drive the agent");
  }
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
