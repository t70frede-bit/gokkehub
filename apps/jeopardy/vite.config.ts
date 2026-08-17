import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@gokkehub/config": path.resolve(__dirname, "../../packages/config/src"),
    },
  },
  // `vite` alone serves the SPA but knows nothing about functions/ — every
  // /game/* and /room/* call would fall through to index.html. Run
  // `npm run dev:functions` alongside `npm run dev` and those routes reach the
  // real Pages Functions on :8788. Ports differ, so nothing clashes with prod.
  server: {
    proxy: {
      // changeOrigin rewrites Host to 127.0.0.1:8788, which matters when you
      // open the app from a phone on the LAN (`npm run dev -- --host`): the
      // dev identity in functions/_session.ts only trusts localhost, and
      // without this the forwarded Host would be your LAN IP and be refused.
      "/game": { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/room": { target: "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
