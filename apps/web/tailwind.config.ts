import type { Config } from "tailwindcss";

// Semantic colour names backed by CSS variables (see app.css), the same
// vocabulary the sibling `uci` project uses. Inlined rather than shared:
// keep `bg-surface` / `text-foreground` / `border-divider` working the same
// way in both, so a component can move between them unchanged.
export default {
  content: ["./index.html", "./src/**/*.{ts,svelte}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Surfaces / containers
        base: "rgb(var(--c-base) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        // Foreground
        foreground: "rgb(var(--c-foreground) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        faint: "rgb(var(--c-faint) / <alpha-value>)",
        // Dividers
        divider: "rgb(var(--c-divider) / <alpha-value>)",
        rule: "rgb(var(--c-rule) / <alpha-value>)",
        // Accent — Italian flag green (primary) + red (alt)
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          muted: "rgb(var(--c-accent-muted) / <alpha-value>)",
          alt: "rgb(var(--c-accent-alt) / <alpha-value>)",
        },
        // Off-white from the flag — used in the tricolor stripe and as
        // a divider highlight on top borders. Alpha-aware so it can
        // layer over the dark base via `bg-flag-white/10`.
        "flag-white": "rgb(var(--c-flag-white) / <alpha-value>)",
        // Status colours used by row painting in parts and drawing lists
        ok: "rgb(var(--c-ok) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
