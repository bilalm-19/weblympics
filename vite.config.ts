import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  build: { outDir: "../dist/client", emptyOutDir: true, target: "es2023" },
  server: {
    // The proxy keeps the browser's Host (no changeOrigin), so the server's
    // Origin check (server/guard.ts: Origin's host must equal Host) passes in
    // dev on :5173, and passkeys use rp id "localhost" as on :8080.
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true, changeOrigin: false },
      "/readme": { target: "http://localhost:8080", changeOrigin: false },
      "/api": { target: "http://localhost:8080", changeOrigin: false },
    },
  },
});
