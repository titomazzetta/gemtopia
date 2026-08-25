import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#101012",
          850: "#16161a",
          800: "#1c1c21",
          700: "#2a2a31",
          600: "#3a3a44",
          500: "#5c5c68",
        },
        accent: {
          DEFAULT: "#4ade80",
          dim: "#22c55e",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
