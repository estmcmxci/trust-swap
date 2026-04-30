import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: [
          "var(--font-jetbrains-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        // Brand — deep "trust blue" inspired by financial-infrastructure
        // tooling (Mercury, Stripe Apps). Cool overtones avoid the
        // generic crypto-pink trap.
        brand: {
          50: "#EEF3FB",
          100: "#D6E2F4",
          200: "#A8BEE6",
          300: "#728FD0",
          400: "#3F62B8",
          500: "#1E40AF", // primary
          600: "#16348C",
          700: "#102868",
          800: "#091B47",
          900: "#040E27",
        },
        // Gold accent — reputation, achievement, weight. Warm, not yellow.
        gold: {
          50: "#FBF6E8",
          100: "#F6EBC4",
          200: "#EFD78C",
          300: "#E2BD58",
          400: "#D6A736",
          500: "#C7942F", // primary accent
          600: "#A57921",
          700: "#7A5817",
          800: "#52380E",
          900: "#2D1F08",
        },
        // Tier ladder — encodes the visual story. Each step climbs.
        tier: {
          none: "#9AA1B0", // muted neutral
          registered: "#7387A8", // cool blue-gray
          discoverable: "#3F66C8", // mid blue
          verified: "#1F9E6E", // emerald (verification check)
          full: "#C7942F", // matches gold (peak reputation)
        },
        ink: {
          DEFAULT: "#0B1226",
          soft: "#1B2440",
          muted: "#56627A",
          faint: "#8F99AE",
        },
        paper: {
          DEFAULT: "#FBF8F1", // warm off-white, financial-paper feel
          subtle: "#F5F1E6",
          deep: "#EFE9D9",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(11, 18, 38, 0.04), 0 8px 24px rgba(11, 18, 38, 0.06)",
        "card-hover":
          "0 1px 2px rgba(11, 18, 38, 0.05), 0 16px 40px rgba(11, 18, 38, 0.10)",
        "card-inset": "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
        ring: "0 0 0 4px rgba(30, 64, 175, 0.18)",
        "gold-ring": "0 0 0 4px rgba(199, 148, 47, 0.22)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      letterSpacing: {
        editorial: "-0.022em",
      },
      animation: {
        "fade-up": "fade-up 480ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "ladder-rise":
          "ladder-rise 720ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft": "pulse-soft 2.4s ease-in-out infinite",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "ladder-rise": {
          from: { transform: "scaleX(0)", opacity: "0" },
          to: { transform: "scaleX(1)", opacity: "1" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
