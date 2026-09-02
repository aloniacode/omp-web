import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BRIDGE = process.env.BRIDGE_PORT ?? "8787";
const BRIDGE_HOST = `http://127.0.0.1:${BRIDGE}`;

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as {
  version: string;
};

/**
 * Runs the RPC bridge as a child of the vite dev server so both share one
 * lifecycle: when vite exits (even when hard-killed — the bridge watches
 * the parent PID) the bridge goes down with it, never orphaning the port.
 * Skipped when a bridge is already listening (e.g. `npm run bridge`).
 * Also relays /ws itself: vite's built-in proxy prints full stack traces
 * for the ECONNABORTED/EPIPE writes that always happen when a page reloads
 * mid-stream, drowning the console at every restart.
 */
function ompBridge(): Plugin {
  let child: ReturnType<typeof spawn> | null = null;
  let stopping = false;
  const root = fileURLToPath(new URL(".", import.meta.url));

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
      // Reuse an already-running bridge instead of fighting for the port.
      // 401 counts as "alive": auth is on, but the bridge is up.
      fetch(`${BRIDGE_HOST}/api/health`)
        .then((res) => {
          if (res.ok || res.status === 401) console.log(`[vite] reusing bridge on :${BRIDGE}`);
          else spawnBridge();
        })
        .catch(spawnBridge);

      server.httpServer?.on("close", killBridge);
      process.once("exit", killBridge);
    },
  };
}

export default defineConfig({
  // Compile-time app version (package.json) for the sidebar badge and settings.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react({
      // React Compiler: auto-memoizes components and JSX (React 19 runtime).
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
    ompBridge(),
  ],
  // Keep every react entry point in ONE optimizer pass: late-discovered deps
  // (compiler-runtime, radix) re-bundle react into fresh chunks, giving the app
  // two React instances ("Invalid hook call" / null dispatcher in dev).
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react/compiler-runtime",
      "@radix-ui/react-collapsible",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-slider",
      "lucide-react",
      "react-markdown",
      "zustand",
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 9527,
    // Sandboxed dev runs redirect the agent home into the workspace; its
    // sqlite wal churn would otherwise trigger endless full page reloads.
    watch: { ignored: ["**/.tmp-home/**"] },
    proxy: {
      "/api": { target: BRIDGE_HOST, changeOrigin: true },
    },
  },
});
