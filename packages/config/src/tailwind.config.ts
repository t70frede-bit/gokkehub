import type { Config } from "tailwindcss";

/**
 * Shared Tailwind config for all GokkeHub apps.
 *
 * All colour values point at CSS custom properties defined in tokens.css.
 * To retheme a game, only the CSS variables need to change — Tailwind
 * class names stay identical across every app.
 *
 * Usage in an app's tailwind.config.ts:
 *   import baseConfig from "@gokkehub/config/tailwind";
 *   export default { ...baseConfig, content: ["./src/**\/*.{ts,tsx}"] };
 */
const config: Omit<Config, "content"> = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // ── Brand (swapped per game via CSS vars) ────────────────────────────
        primary: {
          DEFAULT: "rgb(var(--color-primary-rgb) / <alpha-value>)",
          light:   "rgb(var(--color-primary-light-rgb) / <alpha-value>)",
          dark:    "rgb(var(--color-primary-dark-rgb) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--color-secondary-rgb) / <alpha-value>)",
        },

        // ── Surfaces ─────────────────────────────────────────────────────────
        surface: {
          base:     "rgb(var(--surface-base-rgb) / <alpha-value>)",
          raised:   "rgb(var(--surface-raised-rgb) / <alpha-value>)",
          overlay:  "rgb(var(--surface-overlay-rgb) / <alpha-value>)",
        },

        // ── Text ─────────────────────────────────────────────────────────────
        content: {
          primary:  "rgb(var(--text-primary-rgb) / <alpha-value>)",
          secondary:"rgb(var(--text-secondary-rgb) / <alpha-value>)",
          muted:    "rgb(var(--text-muted-rgb) / <alpha-value>)",
        },

        // ── Team colours — FIXED across all games ────────────────────────────
        team: {
          blue:   "rgb(var(--team-blue-rgb) / <alpha-value>)",
          red:    "rgb(var(--team-red-rgb) / <alpha-value>)",
          green:  "rgb(var(--team-green-rgb) / <alpha-value>)",
          yellow: "rgb(var(--team-yellow-rgb) / <alpha-value>)",
        },

        // ── Status ───────────────────────────────────────────────────────────
        success: "rgb(var(--color-success-rgb) / <alpha-value>)",
        warning: "rgb(var(--color-warning-rgb) / <alpha-value>)",
        danger:  "rgb(var(--color-danger-rgb) / <alpha-value>)",

        // ── New v0.2 helpers ────────────────────────────────────────────────
        bg:      "rgb(var(--bg-rgb) / <alpha-value>)",
        border:  "rgb(var(--border-rgb) / <alpha-value>)",
      },

      borderRadius: {
        sm:  "var(--radius-sm)",
        md:  "var(--radius-md)",
        lg:  "var(--radius-lg)",
        xl:  "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
      },

      fontFamily: {
        sans:    "var(--font-sans)",
        display: "var(--font-display)",
        mono:    "var(--font-mono)",
      },

      backdropBlur: {
        panel: "var(--blur-panel)",
      },

      boxShadow: {
        card:    "var(--shadow-card)",
        glow:    "0 0 28px rgb(var(--color-primary-rgb) / 0.6)",
        "glow-sm":"0 0 14px rgb(var(--color-primary-rgb) / 0.4)",
        team: {
          blue:   "0 0 28px rgb(var(--team-blue-rgb) / 0.9)",
          red:    "0 0 28px rgb(var(--team-red-rgb) / 0.9)",
          green:  "0 0 28px rgb(var(--team-green-rgb) / 0.9)",
          yellow: "0 0 28px rgb(var(--team-yellow-rgb) / 0.9)",
        },
      },

      keyframes: {
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%":   { opacity: "0", transform: "translateX(40px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "victory-pop": {
          "0%":   { transform: "scale(0.5)", opacity: "0" },
          "100%": { transform: "scale(1)",   opacity: "1" },
        },
        "bingo-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 3px rgb(var(--color-warning-rgb) / 0.8), 0 0 24px rgb(var(--color-warning-rgb) / 0.9)" },
          "50%":      { boxShadow: "0 0 0 5px rgb(var(--color-warning-rgb) / 1),   0 0 32px rgb(var(--color-warning-rgb) / 1)" },
        },
      },

      animation: {
        "fade-in":     "fade-in 0.25s ease forwards",
        "slide-in":    "slide-in 0.35s ease forwards",
        "victory-pop": "victory-pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        "bingo-pulse": "bingo-pulse 0.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
