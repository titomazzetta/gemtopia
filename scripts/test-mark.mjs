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
import { readFileSync } from "node:fs";
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

const tailwind = readFileSync(new URL("../tailwind.config.ts", import.meta.url), "utf8");
const hex = (name) => {
  const m = new RegExp(`${name}:\\s*"(#[0-9a-f]{6})"`, "i").exec(tailwind);
  assert.ok(m, `${name} is missing from the palette`);
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
