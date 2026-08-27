import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BRIDGE = process.env.BRIDGE_PORT ?? "8787";
const BRIDGE_HOST = `http://127.0.0.1:${BRIDGE}`;

/**
 * Runs the RPC bridge as a child of the vite dev server so both share one
 * lifecycle: when vite exits (even when hard-killed — the bridge watches
 * the parent PID) the bridge goes down with it, never orphaning the port.
 * Skipped when a bridge is already listening (e.g. `npm run bridge`).
 */
function ompBridge(): Plugin {
  let child: ReturnType<typeof spawn> | null = null;
  const root = fileURLToPath(new URL(".", import.meta.url));

  const spawnBridge = () => {
    if (child) return;
    child = spawn(process.execPath, ["server/bridge.mjs"], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, OMP_PARENT_PID: String(process.pid) },
    });
    child.on("exit", (code) => {
      if (child) child = null;
      if (code != null && code !== 0) console.log(`[vite] bridge exited with code ${code}`);
    });
  };

  const killBridge = () => {
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

  return {
    name: "omp-bridge",
    apply: "serve",
    configureServer(server) {
      // Reuse an already-running bridge instead of fighting for the port.
      fetch(`${BRIDGE_HOST}/api/health`)
        .then((res) => {
          if (res.ok) console.log(`[vite] reusing bridge on :${BRIDGE}`);
          else spawnBridge();
        })
        .catch(spawnBridge);

      server.httpServer?.on("close", killBridge);
      process.once("exit", killBridge);
    },
    closeBundle() {
      killBridge();
    },
  };
}

export default defineConfig({
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
  server: {
    host: "127.0.0.1",
    port: 9527,
    proxy: {
      "/api": { target: BRIDGE_HOST, changeOrigin: true },
      "/ws": { target: `ws://127.0.0.1:${BRIDGE}`, ws: true },
    },
  },
});
