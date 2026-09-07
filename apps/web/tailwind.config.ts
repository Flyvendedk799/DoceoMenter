import type { Config } from "tailwindcss";

/**
 * Tailwind reads the design system rather than restating it: every colour here
 * points at the CSS variable declared in `globals.css`, so the token file stays
 * the single place a value is written down.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "var(--ink-900)",
          850: "var(--ink-850)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
        },
        well: "var(--well)",
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)",
        },
        fg: {
          DEFAULT: "var(--fg)",
          soft: "var(--fg-soft)",
          muted: "var(--fg-muted)",
          faint: "var(--fg-faint)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          bright: "var(--accent-bright)",
          deep: "var(--accent-deep)",
          ink: "var(--accent-ink)",
        },
        warn: "var(--warn)",
        fail: "var(--fail)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        pill: "var(--r-pill)",
      },
      borderColor: {
        DEFAULT: "var(--line)",
      },
      transitionTimingFunction: {
        house: "cubic-bezier(.16,1,.3,1)",
      },
      transitionDuration: {
        micro: "180ms",
        control: "450ms",
        surface: "600ms",
        entrance: "900ms",
      },
      letterSpacing: {
        label: "0.18em",
        eyebrow: "0.22em",
      },
      boxShadow: {
        // The only two shadows in the system.
        float: "0 30px 80px rgba(0,0,0,.45)",
        signal: "0 14px 40px rgba(90,216,230,.3)",
      },
      animation: {
        drift: "dmDrift 26s ease-in-out infinite",
        drift2: "dmDrift2 34s ease-in-out infinite",
        rise: "dmRise 1s cubic-bezier(.16,1,.3,1) both",
        fade: "dmFade 1.4s ease both",
        pulse: "dmPulse 3s ease-in-out infinite",
        sweep: "dmSweep 11s linear infinite",
        bar: "dmBar 2.2s ease-in-out infinite",
        nudge: "dmNudge 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
