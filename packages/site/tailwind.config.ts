import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // Tier badge palette — keyed off synthesis's TrustTier values.
        tier: {
          none: "#52525b",
          registered: "#71717a",
          discoverable: "#0ea5e9",
          verified: "#22c55e",
          full: "#a855f7",
        },
      },
    },
  },
  plugins: [],
};

export default config;
