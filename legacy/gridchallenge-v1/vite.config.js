import { defineConfig } from "vite";
import { resolve } from "path";

// Multi-page app — each HTML file is its own entry point.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, "index.html"),
        join:  resolve(__dirname, "join.html"),
        lobby: resolve(__dirname, "lobby.html"),
        board: resolve(__dirname, "board.html"),
      },
    },
  },
  // Expose VITE_* env vars to the browser bundle.
  // VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local.
  envPrefix: "VITE_",
});
