import baseConfig from "@gokkehub/config/tailwind";
import type { Config } from "tailwindcss";

export default {
  ...baseConfig,
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    // Always scan the shared UI package source so its utility classes are emitted.
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
