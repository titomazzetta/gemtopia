/**
 * Octave choice: genre pockets and your own range.
 *
 *   npm run test:bpm-range
 *
 * The estimator hears a pulse and cannot know a convention — 174 and 87 are
 * the same onsets. These tests pin *which* octave gets reported, against
 * synthetic signals whose true tempo is known, and they pin the trade-offs of
 * the 70–160 default as well as its wins, so nobody changes it without seeing
 * what it costs.
 */
import assert from "node:assert/strict";
import { estimateTempo, DEFAULT_FOLD } from "../src/client/tempo.ts";
import {
  DEFAULT_RANGE,
  RANGE_FLOOR,
  RANGE_CEILING,
  MIN_RANGE_SPAN,
  POCKET_SCORE_RATIO,
  RANGE_SCORE_RATIO,
  foldWindow,
  normaliseRange,
  pocketFor,
} from "../src/client/bpmRange.ts";

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

const HOP = 0.01;

/**
 * The same pattern synthesis as test-tempo.mjs — kick on the beat, optional
 * off-beat hat and backbeat snare — without the noise, so each case measures
 * the octave decision and nothing else.
 */
function synthesise({ bpm, seconds = 14, offbeat = false, snare = false }) {
  const length = Math.round(seconds / HOP);
  const envelope = new Float32Array(length).fill(0.25);
  const beat = 60 / bpm;
  const strike = (t, amplitude) => {
    const centre = Math.round(t / HOP);
    for (let k = 0; k < 8; k++) {
      const i = centre + k;
      if (i >= 0 && i < length) envelope[i] += amplitude * Math.exp(-k / 2.2);
    }
  };
  for (let b = 0; b < Math.floor(seconds / beat); b++) {
    const t = b * beat;
    strike(t, 1);
    if (offbeat) strike(t + beat / 2, 0.45);
    if (snare && b % 4 === 1) strike(t, 0.7);
    if (snare && b % 4 === 3) strike(t, 0.7);
  }
  return envelope;
}

const near = (got, want, tolerance, what) =>
  assert.ok(Math.abs(got - want) <= tolerance, `${what}: got ${got}, expected ${want} ±${tolerance}`);

const read = (signal, styles, range = DEFAULT_RANGE) =>
  estimateTempo(signal, HOP, foldWindow(range, pocketFor(styles, [])))?.bpm;

const DNB = synthesise({ bpm: 174, offbeat: true, snare: true });
const DUBSTEP = synthesise({ bpm: 140, offbeat: true, snare: true });

/* ---- the win ---- */

console.log("\ngenre pockets settle the octave");

check("tagged drum & bass reads 174, not 87", () => {
  // The limitation test-tempo.mjs could only document as "splits between
  // octaves". With the record's own tag, it does not split.
  near(read(DNB, ["Drum n Bass"]), 174, 2, "DnB");
});

check("jungle is counted the same way", () => {
  const jungle = synthesise({ bpm: 172, offbeat: true, snare: true });
  near(read(jungle, ["Jungle"]), 172, 2, "jungle");
});

check("tagged dubstep reads 140, not 70", () => {
  near(read(DUBSTEP, ["Dubstep"]), 140, 2, "dubstep");
});

check("pockets leave records that were already right alone", () => {
  near(read(synthesise({ bpm: 124, offbeat: true }), ["Deep House"]), 124, 1.5, "house");
  near(read(synthesise({ bpm: 90, snare: true }), ["Boom Bap"]), 90, 1.5, "hip hop");
  near(read(synthesise({ bpm: 76, snare: true }), ["Dub"]), 76, 1.5, "roots");
});

/* ---- the trade-offs, pinned deliberately ---- */

console.log("\nwhat the 70–160 default costs, measured");

check("untagged drum & bass reads at half-time under 70–160", () => {
  // Stated in bpmRange.ts and pinned here: 160 sits below DnB. If this starts
  // reading 174 without a tag, the default changed — make sure that was meant.
  near(read(DNB, []), 87, 2, "untagged DnB");
});

check("untagged dubstep reads at half-time under 70–160", () => {
  // The one the design did not predict and the probe found. 70 is inside
  // 70–160, so the estimator's half-time reading is kept; the old 82–176
  // window folded it up to 140. Tagged dubstep is unaffected.
  near(read(DUBSTEP, []), 70, 2, "untagged dubstep");
  near(estimateTempo(DUBSTEP, HOP, DEFAULT_FOLD).bpm, 140, 2, "old window");
});

check("slow music is no longer pushed up an octave", () => {
  // The win on the other side of the same trade: a 72 BPM downtempo record
  // stays 72 rather than being offered to 144.
  near(read(synthesise({ bpm: 72 }), []), 72, 1.5, "downtempo");
});

check("the default range is the one Tito asked for", () => {
  assert.deepEqual(DEFAULT_RANGE, { low: 70, high: 160 });
});

/* ---- pocket lookup ---- */

console.log("\nfinding a record's pocket");

check("a style names its pocket", () => {
  const p = pocketFor(["Drum n Bass"], ["Electronic"]);
  assert.deepEqual({ low: p.low, high: p.high, name: p.name }, { low: 160, high: 180, name: "Drum n Bass" });
});

check("matching ignores case and stray spaces", () => {
  assert.equal(pocketFor(["  drum n bass "], [])?.name, "Drum n Bass");
});

check("an unknown style says nothing", () => {
  assert.equal(pocketFor(["Musique Concrète"], ["Electronic"]), null);
});

check("two styles from one pocket name it once", () => {
  assert.equal(pocketFor(["Drum n Bass", "Jungle"], [])?.name, "Drum n Bass");
});

check("a genre is used only when no style speaks", () => {
  assert.equal(pocketFor([], ["Hip Hop"])?.name, "Hip Hop");
  assert.equal(pocketFor(["Deep House"], ["Hip Hop"])?.name, "House");
  // "Electronic" is far too broad to be tempo evidence.
  assert.equal(pocketFor([], ["Electronic"]), null);
});

check("disagreeing styles merge only while narrower than an octave", () => {
  // Deep House + Downtempo → 70–132. 132 / 70 = 1.89: still unambiguous.
  const merged = pocketFor(["Deep House", "Downtempo"], []);
  assert.deepEqual([merged.low, merged.high], [70, 132]);
  // Drum n Bass + Downtempo → 70–180. 2.57 — could fold 87 or 174, so it
  // says nothing and your own range decides.
  assert.equal(pocketFor(["Drum n Bass", "Downtempo"], []), null);
});

check("every pocket on its own is narrower than an octave and reachable", () => {
  // Wider than an octave, a pocket could fold one reading two ways; outside
  // 60–200, the estimator can never report into it.
  const styles = [
    "Drum n Bass", "Footwork", "Hardcore", "Dubstep", "Trance", "UK Garage",
    "Breakbeat", "Techno", "House", "Electro", "Amapiano", "Disco", "Afrobeat",
    "Balearic", "Funk", "Dancehall", "Boom Bap", "Downtempo", "Dub",
  ];
  for (const style of styles) {
    const p = pocketFor([style], []);
    assert.ok(p, `${style} has no pocket`);
    assert.ok(p.high / p.low < 2, `${style} spans an octave or more`);
    assert.ok(p.low >= RANGE_FLOOR && p.high <= RANGE_CEILING, `${style} unreachable`);
  }
});

/* ---- the window handed to the estimator ---- */

console.log("\nthe fold window");

check("a pocket relaxes the evidence bar; a plain range does not", () => {
  assert.equal(foldWindow(DEFAULT_RANGE, pocketFor(["Dubstep"], [])).minScoreRatio, POCKET_SCORE_RATIO);
  assert.equal(foldWindow(DEFAULT_RANGE, null).minScoreRatio, RANGE_SCORE_RATIO);
  assert.ok(POCKET_SCORE_RATIO > 0, "a tag must never fold onto an octave with no support at all");
  assert.ok(POCKET_SCORE_RATIO < RANGE_SCORE_RATIO);
});

check("no pocket means your range", () => {
  const w = foldWindow({ low: 85, high: 175 }, null);
  assert.deepEqual([w.low, w.high], [85, 175]);
});

/* ---- tidying a typed range ---- */

console.log("\ntidying a typed range");

check("a sensible range passes through", () => {
  assert.deepEqual(normaliseRange(70, 160), { low: 70, high: 160 });
});

check("a reversed range is swapped, not refused", () => {
  assert.deepEqual(normaliseRange(160, 70), { low: 70, high: 160 });
});

check("out-of-reach values are clamped to what the estimator can report", () => {
  assert.deepEqual(normaliseRange(20, 400), { low: RANGE_FLOOR, high: RANGE_CEILING });
});

check("a span too narrow to mean anything is refused", () => {
  assert.equal(normaliseRange(120, 120 + MIN_RANGE_SPAN - 1), null);
  assert.ok(normaliseRange(120, 120 + MIN_RANGE_SPAN));
});

check("garbage is refused rather than guessed", () => {
  assert.equal(normaliseRange(Number.NaN, 160), null);
  assert.equal(normaliseRange(70, Infinity), null);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} BPM range tests failed.`);
  process.exit(1);
}
console.log(`\nAll ${ran} BPM range tests passed.`);
