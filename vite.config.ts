import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const BRIDGE = process.env.BRIDGE_PORT ?? "8787";

export default defineConfig({
  plugins: [
    react({
      // React Compiler: auto-memoizes components and JSX (React 19 runtime).
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  server: {
    host: "127.0.0.1",
    port: 9527,
    proxy: {
      "/api": { target: `http://127.0.0.1:${BRIDGE}`, changeOrigin: true },
      "/ws": { target: `ws://127.0.0.1:${BRIDGE}`, ws: true },
    },
  },
});
