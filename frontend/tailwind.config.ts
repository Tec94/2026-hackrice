import type { Config } from "tailwindcss";

/**
 * Three surfaces, one accent.
 *
 *   base    page background, the darkest plane
 *   panel   cards, sidebars, headers — one step up
 *   raised  inputs, hover states, the only third level
 *
 * Boundaries are mostly a background shift; `line` is reserved for the few
 * places a real rule is needed. Accent is a single indigo ramp; amber marks
 * replay/future notices; bull/bear are supplemental to text, never alone.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Near-black ground with two barely-separated surfaces above it. */
        ground: "#0a0a0a",
        panel: "#121212",
        raised: "#1c1c1c",
        line: "#262626",

        ink: {
          DEFAULT: "#f2f2f2",
          muted: "#a8a8a8",
          faint: "#6b6b6b",
        },

        /* Amber is the brand accent: badges, primary marks, replay notices. */
        accent: {
          50: "#fdf6e8",
          200: "#f0d9a8",
          300: "#e3be76",
          400: "#d4a24b",
          500: "#c08a33",
          600: "#9d6f28",
          700: "#7a561f",
        },

        /* Kept as an alias so replay/future notices read amber too. */
        replay: {
          200: "#f0d9a8",
          300: "#e3be76",
          400: "#d4a24b",
          500: "#c08a33",
          600: "#9d6f28",
        },

        /* Violet is reserved for coach/voice activity only. */
        coach: {
          300: "#b3a7f5",
          400: "#9184ee",
          500: "#7c6ce4",
        },

        bull: { DEFAULT: "#4ec9a0", soft: "#10322a" },
        bear: { DEFAULT: "#e8695f", soft: "#3a1a18" },
      },

      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        tiny: ["0.75rem", { lineHeight: "1.125rem" }],
        base: ["0.875rem", { lineHeight: "1.375rem" }],
        lead: ["1rem", { lineHeight: "1.5rem" }],
        title: ["1.375rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em" }],
        display: ["2.25rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em" }],
        hero: ["3.25rem", { lineHeight: "1.05", letterSpacing: "-0.035em" }],
      },

      borderRadius: { xl2: "0.875rem" },

      height: { touch: "44px" },
      width: { touch: "44px" },
      minHeight: { touch: "44px" },
      minWidth: { touch: "44px" },

      gridTemplateColumns: { workspace: "minmax(0,1fr) minmax(340px,26%)" },

      boxShadow: {
        panel: "0 1px 2px rgba(0,0,0,0.4)",
        lift: "0 8px 30px -12px rgba(0,0,0,0.7)",
        glow: "0 0 0 6px rgba(192,138,51,0.12)",
      },

      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(124,108,228,0.45)" },
          "70%": { boxShadow: "0 0 0 18px rgba(124,108,228,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(124,108,228,0)" },
        },
        riseIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulseRing 1.6s ease-out infinite",
        "rise-in": "riseIn 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
export default config;
