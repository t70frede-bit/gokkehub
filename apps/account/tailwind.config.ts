import baseConfig from "@gokkehub/config/tailwind";
import type { Config } from "tailwindcss";

export default {
  ...baseConfig,
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
