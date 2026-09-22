import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /*
       * Phosphor.
       *
       * The ink ramp is tinted green rather than neutral, which is the whole
       * difference between "a dark UI" and a room with a colour in it. Seven
       * steps, same structure as before — only the hue moved, so every
       * `bg-ink-850` and `text-neutral-500` in the app carried over untouched.
       *
       * Chosen for legibility as much as for looks: on a green-black ground
       * both accents clear AAA rather than scraping AA, which matters when the
       * screen is being read at arm's length in a dark booth. The amber is the
       * second voice — BPM readouts, "in collection" badges — and green-on-
       * amber is the one pairing here with real history behind it, because it
       * is what monochrome terminals actually did.
       */
      colors: {
        ink: {
          950: "#050806",
          900: "#0a100c",
          850: "#0d140f",
          800: "#131d16",
          700: "#1b2a1f",
          600: "#2a4231",
          500: "#6f8a78",
        },
        accent: {
          DEFAULT: "#5ef08a",
          dim: "#3fc76b",
          alt: "#ffb000",
        },
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        "spin-record": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
      },
      animation: {
        // Slower than a real 33rpm platter. At true speed the label fleck
        // strobes against a 60Hz refresh and reads as juddering rather than
        // turning, which looks broken — the opposite of the point.
        "spin-record": "spin-record 1.8s linear infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
