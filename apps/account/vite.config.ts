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
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
