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
  // /room/*, /catalog and /track-search call would fall through to index.html
  // and come back as HTML, which is why a local run silently behaved as if
  // every endpoint were broken. Run `npm run dev:functions` alongside
  // `npm run dev` and those routes reach the real Pages Functions on :8788.
  // Mirrors apps/jeopardy's setup; ports differ so nothing clashes.
  server: {
    proxy: {
      "/room":         { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/catalog":      { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/track-search": { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/spotify":      { target: "http://127.0.0.1:8788", changeOrigin: true },
      "/spotify-token":{ target: "http://127.0.0.1:8788", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
