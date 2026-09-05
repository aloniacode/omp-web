import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { ompBridge } from "./plugins/dev-bridge";

const BRIDGE = process.env.BRIDGE_PORT ?? "8787";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as {
  version: string;
};

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
    // Bridge lifecycle + /ws relay — see plugins/dev-bridge.ts.
    ompBridge(),
  ],
  // Keep every react entry point in ONE optimizer pass: late-discovered deps
  // (compiler-runtime, radix) re-bundle react into fresh chunks, giving the
  // app two React instances ("Invalid hook call" / null dispatcher in dev).
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
      "/api": { target: `http://127.0.0.1:${BRIDGE}`, changeOrigin: true },
    },
  },
});
