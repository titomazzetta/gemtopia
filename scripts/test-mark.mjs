/**
 * Mark and palette tests.
 *
 *   npm run test:mark
 *
 * Two things worth pinning, for the same reason the header tests exist: both
 * are values that look arbitrary in a diff and are not.
 *
 * The cut rule, because "just scale the SVG" is the obvious simplification and
 * it is wrong — a hairline that reads at 96px is a smudge at 16, which is how
 * a logo ends up looking broken only in the browser tab, the one place nobody
 * reviews.
 *
 * The palette, because this app has now had three separate regressions where a
 * value that reads as tidy in review silently removed something. Contrast is
 * measured here rather than asserted, so a "nicer" green that stops clearing
 * AA against the ground fails the build instead of failing a viewer in a dark
 * room.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cutForSize, MICRO_MAX, DISPLAY_MIN, LOCKUP_RATIO } from "../src/client/markCuts.ts";

let ran = 0;
let failed = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

/* ---- the cut rule ---- */

check("a favicon gets the solid cut", () => {
  for (const size of [12, 16, 20, 23]) assert.equal(cutForSize(size), "micro");
});

check("working sizes get the five-facet cut", () => {
  for (const size of [24, 32, 40, 63]) assert.equal(cutForSize(size), "text");
});

check("large sizes get the hairline cut", () => {
  for (const size of [64, 96, 240]) assert.equal(cutForSize(size), "display");
});

check("the boundaries are exactly where they claim to be", () => {
  // Off-by-one here means one size renders the wrong drawing, which is the
  // kind of thing nobody notices until a printer does.
  assert.equal(cutForSize(MICRO_MAX - 1), "micro");
  assert.equal(cutForSize(MICRO_MAX), "text");
  assert.equal(cutForSize(DISPLAY_MIN - 1), "text");
  assert.equal(cutForSize(DISPLAY_MIN), "display");
});

check("every cut is reachable", () => {
  const seen = new Set([1, 24, 64, 512].map(cutForSize));
  assert.deepEqual([...seen].sort(), ["display", "micro", "text"]);
});

/* ---- the drawing ---- */

const source = readFileSync(new URL("../src/components/Mark.tsx", import.meta.url), "utf8");

check("all three cuts share one silhouette", () => {
  // Declared once, in the rule module. Three copies of the polygon is three
  // chances for the cuts to drift into three different logos, which is the
  // specific way a hand-drawn icon set stops being a set.
  const rules = readFileSync(new URL("../src/client/markCuts.ts", import.meta.url), "utf8");
  assert.equal(
    (rules.match(/export const STONE = "/g) ?? []).length,
    1,
    "the silhouette should be declared exactly once",
  );
  const literalPolygons = source.match(/points="[\d]/g) ?? [];
  assert.equal(
    literalPolygons.length,
    0,
    "a cut is drawing its own polygon instead of using STONE",
  );
});

check("knockouts are masked, never painted with the background", () => {
  // Comments stripped first: the doc comment explains this rule by naming the
  // colour, and a test that cannot tell prose from code fails on its own
  // explanation. Same lesson as test-write-surface.mjs, which did exactly this.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(code.includes("<mask"), "the micro cut needs a real mask");
  assert.ok(
    !/#050806/.test(code),
    "a knockout filled with the app background carries a dark square onto every other surface",
  );
});

check("colour is inherited, so there is no variant per background", () => {
  assert.ok(source.includes("currentColor"));
  assert.ok(!/fill="#(?!fff|000)/.test(source), "a hard-coded colour in the mark");
});

check("the lockup ratio is stated once and is not 1", () => {
  // A deep brilliant is taller than it is wide; matching the wordmark's box
  // makes it loom. Stated as a constant so it cannot be eyeballed per screen.
  assert.ok(LOCKUP_RATIO > 0.8 && LOCKUP_RATIO < 1);
});

/* ---- the palette ---- */

// Tailwind 4 keeps the theme in CSS: `--color-ink-950: #050806;` and so on.
const theme = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const TOKENS = { "950": "--color-ink-950", DEFAULT: "--color-accent", alt: "--color-accent-alt" };
const hex = (name) => {
  const token = TOKENS[name] ?? name;
  const m = new RegExp(`${token}:\\s*(#[0-9a-f]{6})\\s*;`, "i").exec(theme);
  assert.ok(m, `${token} is missing from the palette`);
  return m[1];
};

function luminance(value) {
  const channels = [1, 3, 5].map((i) => {
    const v = parseInt(value.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

check("both accents clear AA against the ground", () => {
  const ground = hex("950");
  for (const name of ["DEFAULT", "alt"]) {
    const value = hex(name);
    const contrast = ratio(value, ground);
    assert.ok(
      contrast >= 4.5,
      `accent.${name} ${value} is ${contrast.toFixed(2)}:1 on ${ground} — under AA`,
    );
  }
});

/*
 * The quiet greys: neutral-500, 600 and 700, which between them set nearly
 * every caption, meta line, count and placeholder in the app.
 *
 * They were Tailwind's stock values, and on this ground those are 4.2, 2.6
 * and 1.9 to 1. Nothing looked wrong in review, because a reviewer reads a
 * screen at a desk; an accessibility scan found text under AA on every one of
 * 36 screens. Measured here against each surface text actually sits on, so
 * the next "a bit subtler" fails the build rather than a reader.
 */
const GREYS = ["--color-neutral-400", "--color-neutral-500", "--color-neutral-600", "--color-neutral-700"];

/** One colour laid over another at an opacity, as `bg-accent/10` over a surface is. */
function over(top, alpha, under) {
  const channel = (i) => {
    const [t, u] = [top, under].map((value) => parseInt(value.slice(i, i + 2), 16));
    return Math.round(u + alpha * (t - u)).toString(16).padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

check("every grey the app writes text in clears AA on every surface text sits on", () => {
  const surfaces = [
    ["the ground (ink-950)", hex("--color-ink-950")],
    ["ink-900", hex("--color-ink-900")],
    ["ink-850", hex("--color-ink-850")],
    ["ink-800, a ticked or hovered row", hex("--color-ink-800")],
    // The row that is playing: bg-accent/10 over the list.
    ["the playing row", over(hex("--color-accent"), 0.1, hex("--color-ink-900"))],
  ];
  for (const token of GREYS) {
    for (const [name, surface] of surfaces) {
      const contrast = ratio(hex(token), surface);
      assert.ok(
        contrast >= 4.5,
        `${token} ${hex(token)} is ${contrast.toFixed(2)}:1 on ${name} ${surface} — under AA for text`,
      );
    }
  }
});

check("the quiet greys keep their order", () => {
  // Never lighter than the step above: a "500" brighter than "400" would
  // turn every secondary line into the loudest thing in its row.
  const steps = GREYS.map((token) => luminance(hex(token)));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] <= steps[i - 1], `${GREYS[i]} is lighter than ${GREYS[i - 1]}`);
  }
  assert.ok(steps[1] < steps[0], "neutral-500 should still read as quieter than neutral-400");
});

/** Every run of class names written in a component: the text between two quote marks. */
function classRuns() {
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
    });
  return files(root).flatMap((path) =>
    readFileSync(path, "utf8")
      .split(/["'`]/)
      .map((run) => ({ path: path.slice(root.length + 1), tokens: run.split(/\s+/) })),
  );
}
const QUIET = /^text-neutral-(?:500|600|700)$/;

check("the lighter surfaces carry no quiet text", () => {
  // ink-700, ink-600 and the stronger accent tints are bars, active tabs and
  // pressed chips. A quiet grey is under 4.5:1 on them (4.35 on ink-700), so
  // what is written on them is the accent or near-white, never a caption.
  const light = /^(?:[a-z-]+:)*bg-(?:ink-(?:700|600|500)|accent\/(?:1[5-9]|[2-9]\d))$/;
  for (const { path, tokens } of classRuns()) {
    if (!tokens.some((token) => light.test(token))) continue;
    const quiet = tokens.find((token) => QUIET.test(token));
    assert.ok(!quiet, `${path}: ${quiet} on ${tokens.find((token) => light.test(token))}`);
  }
});

/** A selected chip's tint: `bg-accent/15` over each surface a chip sits on. */
const SELECTED_TINTS = ["--color-ink-950", "--color-ink-900", "--color-ink-850"].map((token) => [
  `accent/15 over ${token.replace("--color-", "")}`,
  over(hex("--color-accent"), 0.15, hex(token)),
]);

check("on a selected chip's tint, the dimmer accent clears AA", () => {
  // Quiet greys are 3.9 to 4.4:1 there, so text inside a chip that can be
  // selected switches to the dimmer accent when it is (the next check).
  for (const [name, tint] of SELECTED_TINTS) {
    const contrast = ratio(hex("--color-accent-dim"), tint);
    assert.ok(contrast >= 4.5, `accent-dim is ${contrast.toFixed(2)}:1 on ${name} ${tint}`);
  }
});

check("text inside a chip switches colour when the chip is selected", () => {
  /*
   * The first scan had no chip selected, so it never saw the count inside one
   * sitting on the chip's own tint at 4.0:1. A second scan, with a filter chip
   * on, did. Every <button> that can carry a light tint is read for a quiet
   * grey (600 or 700, under AA on every tint) written as a plain class that
   * cannot change with the button's state. A class chosen by a condition is
   * trusted to be the one above; this is a net for the plain kind.
   */
  const tinted = /bg-(?:accent\/(?:1[5-9]|[2-9]\d)|ink-(?:700|600))(?![\w/])/;
  const plainQuiet = /className="[^"]*\btext-neutral-(?:600|700)\b[^"]*"/;
  /** The button's own className (the first in the block), and everything after it. */
  const ownClass = (block) => {
    const at = block.indexOf("className=");
    if (at < 0) return { own: "", rest: block };
    const start = at + "className=".length;
    if (block[start] === '"') {
      const end = block.indexOf('"', start + 1);
      return { own: block.slice(start + 1, end), rest: block.slice(end + 1) };
    }
    let depth = 0;
    for (let i = start; i < block.length; i += 1) {
      if (block[i] === "{") depth += 1;
      else if (block[i] === "}" && (depth -= 1) === 0) return { own: block.slice(start, i + 1), rest: block.slice(i + 1) };
    }
    return { own: "", rest: block };
  };
  const root = fileURLToPath(new URL("../src", import.meta.url));
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
    });
  let tintable = 0;
  for (const path of files(root)) {
    for (const [button] of readFileSync(path, "utf8").matchAll(/<button\b[\s\S]*?<\/button>/g)) {
      const { own, rest } = ownClass(button);
      if (!tinted.test(own)) continue;
      tintable += 1;
      const quiet = rest.match(plainQuiet)?.[0];
      assert.ok(!quiet, `${path.slice(root.length + 1)}: ${quiet} inside a button that can be tinted`);
    }
  }
  // If the reading above ever stops finding the chips, this says so.
  assert.ok(tintable >= 10, `only ${tintable} buttons that can be tinted were found`);
});

check("quiet text still answers the pointer", () => {
  // Hovering used to take a quiet grey up to neutral-400, a visible step when
  // the greys were darker. From today's values it is 1.2 to 1.4:1 — a hover
  // nobody can see. A quiet control lights up to 300 or brighter, or to the accent.
  const faint = /^(?:group-)?hover:text-neutral-(?:400|500|600|700)$/;
  for (const { path, tokens } of classRuns()) {
    const quiet = tokens.find((token) => QUIET.test(token));
    const hover = tokens.find((token) => faint.test(token));
    assert.ok(!(quiet && hover), `${path}: ${quiet} with ${hover}`);
  }
});

check("the ink ramp gets lighter in one direction, with no ties", () => {
  // A ramp that doubles back produces borders lighter than the surface they
  // sit on, which reads as a rendering bug rather than a design choice.
  const steps = [950, 900, 850, 800, 700, 600, 500].map((s) => luminance(hex(String(s))));
  for (let i = 1; i < steps.length; i += 1) {
    assert.ok(steps[i] > steps[i - 1], `ink-${[950, 900, 850, 800, 700, 600, 500][i]} is not lighter than the step before it`);
  }
});

check("the ground is dark enough to be a dark theme at all", () => {
  assert.ok(luminance(hex("950")) < 0.02);
});

function hue(value) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

check("the two accents separate by hue, which is how they are told apart", () => {
  /*
   * This test was written measuring contrast ratio and it was measuring the
   * wrong thing. Green and amber come out at 1.16:1 — nearly identical
   * luminance — while being about as easy to tell apart as two colours get.
   * Luminance contrast answers "can I read this on that", not "are these two
   * different".
   *
   * The right measure is angular hue distance, and these sit roughly 96 apart.
   *
   * The 1.16 is worth knowing rather than discarding, though: with hue removed
   * these two are almost the same colour, so a red-green colour-blind viewer
   * has very little to go on. Anywhere the accents distinguish two states, the
   * colour must not be the only thing distinguishing them — which today it is
   * not, since the BPM readout carries a number and the badge carries a word.
   */
  const separation = Math.abs(hue(hex("DEFAULT")) - hue(hex("alt")));
  const angular = Math.min(separation, 360 - separation);
  assert.ok(angular >= 60, `only ${angular.toFixed(0)} degrees apart`);
});

check("the theme colour matches the ground the app actually paints", () => {
  const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const m = /themeColor:\s*"(#[0-9a-f]{6})"/i.exec(layout);
  assert.ok(m, "themeColor is missing");
  assert.equal(
    m[1].toLowerCase(),
    hex("950").toLowerCase(),
    "the browser chrome would be a different colour from the page",
  );
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} mark tests failed.`);
  process.exit(1);
}
console.log(`\nAll ${ran} mark tests passed.`);
