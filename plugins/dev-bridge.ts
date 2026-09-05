/**
 * Vite dev plugin: owns the bridge process lifecycle so `pnpm dev` is the
 * only thing to start. Extracted from vite.config.ts to keep the config to
 * wiring. See the plugin's doc block for the lifecycle contract.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import type { Plugin, ViteDevServer } from "vite";
import { TOKEN_FILE } from "../server/auth-token.mjs";
import { computeServerFingerprint } from "../server/server-fingerprint.mjs";

const BRIDGE = process.env.BRIDGE_PORT ?? "8787";
const BRIDGE_HOST = `http://127.0.0.1:${BRIDGE}`;

/**
 * Runs the RPC bridge as a child of the vite dev server so both share one
 * lifecycle. Two mechanisms keep them in lockstep:
 *
 * - heartbeat: this plugin pings /api/bridge/ping every 2s; a bridge whose
 *   pings go silent (its vite died, and no other vite adopted it) exits
 *   within ~6s. Immune to Windows PID reuse, unlike a raw PID probe.
 * - adoption: a bridge already on the port is reused only when it is healthy
 *   AND runs the current server code (fingerprint match) AND belongs to a
 *   live vite. Anything else — orphan from a hard kill, or started before
 *   server-file changes — is replaced with a fresh spawn, so a quick
 *   close-and-restart never inherits stale bridge behavior.
 *
 * Also relays /ws itself: vite's built-in proxy prints full stack traces
 * for the ECONNABORTED/EPIPE writes that always happen when a page reloads
 * mid-stream, drowning the console at every restart.
 */
export function ompBridge(): Plugin {
  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  let pinger: ReturnType<typeof setInterval> | null = null;
  let fingerprint = "";
  const root = fileURLToPath(new URL("../", import.meta.url));

  const spawnBridge = () => {
    if (child) return;
    child = spawn(process.execPath, ["server/bridge.mjs"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, OMP_PARENT_PID: String(process.pid) },
    });
    child.on("exit", (code) => {
      if (stopping || !child) return;
      child = null;
      // Crash: bring it back so a bridge hiccup doesn't need a dev restart.
      console.log(`[vite] bridge exited (code ${code}), restarting in 2s…`);
      setTimeout(() => {
        if (!stopping && !child) spawnBridge();
      }, 2000);
    });
  };

  const killBridge = () => {
    stopping = true;
    if (!child?.pid) return;
    const pid = child.pid;
    child = null;
    if (process.platform === "win32") {
      // Kill the whole tree (bridge + agent children).
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  };

  const readToken = (): string | null => {
    try {
      return readFileSync(TOKEN_FILE, "utf8").trim() || null;
    } catch {
      return null;
    }
  };

  /** Authenticated liveness probe. Returns the health payload, a marker for
   *  "alive but the token doesn't open it", or null when unreachable. */
  const probeBridge = async (): Promise<Record<string, unknown> | { aliveOnly: true } | null> => {
    const token = readToken();
    try {
      const res = await fetch(`${BRIDGE_HOST}/api/health`, {
        headers: token ? { "x-omp-web-token": token } : undefined,
        signal: AbortSignal.timeout(1500),
      });
      if (res.status === 401) return { aliveOnly: true };
      if (!res.ok) return null;
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  // The heartbeat doubles as the bridge's parent-liveness signal, so it runs
  // for spawned and adopted bridges alike, and stops only with this process.
  const startPingLoop = () => {
    if (pinger) return;
    pinger = setInterval(() => {
      if (stopping) return;
      const token = readToken();
      void fetch(`${BRIDGE_HOST}/api/bridge/ping`, {
        headers: token ? { "x-omp-web-token": token } : undefined,
        signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    }, 2000);
  };

  const pidAlive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const killByPid = (pid: number) => {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
    }
  };

  const waitForBridgeDeath = async (pid: number, ms = 5000): Promise<boolean> => {
    const deadline = Date.now() + ms;
    for (;;) {
      if (!pidAlive(pid)) return true;
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  /** Reuse a healthy bridge owned by another live dev server; replace one
   *  that is orphaned (its vite is gone) or predates server-code changes —
   *  blindly reusing those is what made quick restarts run stale code. */
  const adoptOrSpawnBridge = async () => {
    if (stopping) return;
    const health = await probeBridge();
    if (health && "aliveOnly" in health) {
      console.log(`[vite] reusing bridge on :${BRIDGE} (token mismatch — cannot inspect)`);
      startPingLoop();
      return;
    }
    if (health) {
      const ppid = Number(health.ppid ?? 0);
      // A bridge that doesn't even report a fingerprint predates the check —
      // it can't prove freshness, so it counts as stale.
      const stale = typeof health.fingerprint !== "string" || health.fingerprint !== fingerprint;
      const orphan = ppid > 0 && ppid !== process.pid && !pidAlive(ppid);
      if (!stale && !orphan) {
        console.log(`[vite] reusing bridge on :${BRIDGE} (pid ${String(health.pid)})`);
        startPingLoop();
        return;
      }
      const why = stale ? "server code changed since it started" : "its vite is gone";
      console.log(`[vite] bridge on :${BRIDGE} is superseded (${why}) — replacing it`);
      if (typeof health.pid === "number") {
        killByPid(health.pid);
        if (!(await waitForBridgeDeath(health.pid))) {
          console.error(`[vite] could not stop the old bridge (pid ${health.pid})`);
        }
      }
    }
    spawnBridge();
    startPingLoop();
  };

  /** Expected-when: socket writes racing a page reload / bridge restart. */
  const quiet = (err: NodeJS.ErrnoException) => {
    const code = String(err.code);
    if (!["ECONNABORTED", "EPIPE", "ECONNRESET", "ECONNREFUSED"].includes(code)) {
      console.error(`[vite] ws relay error: ${err.message}`);
    }
  };

  /** Relay browser <-> bridge frames without vite's proxy stack traces. */
  const relayWs = (server: ViteDevServer) => {
    const wss = new WebSocketServer({ noServer: true });
    server.httpServer?.on("upgrade", (req, socket, head) => {
      if (!req.url?.split("?")[0].startsWith("/ws")) return;
      wss.handleUpgrade(req, socket, head, (client) => {
        // req.url already carries the path and any ?token= auth query.
        const upstream = new WebSocket(`ws://127.0.0.1:${BRIDGE}${req.url}`);
        const pending: Array<Parameters<WebSocket["send"]>[0]> = [];
        client.on("error", quiet);
        upstream.on("error", quiet);
        client.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
          else if (upstream.readyState === WebSocket.CONNECTING) pending.push(data);
        });
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        upstream.on("open", () => {
          for (const data of pending.splice(0)) upstream.send(data);
        });
        const teardown = () => {
          try {
            upstream.terminate();
          } catch {}
          try {
            client.terminate();
          } catch {}
        };
        client.on("close", teardown);
        upstream.on("close", teardown);
      });
    });
  };

  return {
    name: "omp-bridge",
    apply: "serve",
    configureServer(server) {
      relayWs(server);
      fingerprint = computeServerFingerprint();
      void adoptOrSpawnBridge();
      startPingLoop();

      server.httpServer?.on("close", killBridge);
      process.once("exit", killBridge);
    },
  };
}
