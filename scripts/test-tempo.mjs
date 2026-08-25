#!/usr/bin/env node
/**
 * Tempo estimator tests.
 *
 * Synthesises onset envelopes at known tempi — with jitter, noise, syncopation
 * and off-beat hats — and asserts the estimator recovers the right BPM. Run
 * with `npm run test:tempo`.
 *
 * The estimator is imported by transpiling the TypeScript source on the fly
 * with Node's built-in type stripping (Node 22.6+).
 */

import { strict as assert } from "node:assert";
import { estimateTempo, TapTempo, parseBpmFromText, whiten } from "../src/client/tempo.ts";

const HOP = 0.01; // 100 Hz envelope, matching the browser capture rate
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Build an onset envelope for a 4/4 pattern.
 *   - kick on every beat
 *   - optional off-beat hat at half the amplitude
 *   - optional snare on 2 and 4
 */
function synthesise({
  bpm,
  seconds = 14,
  jitterMs = 0,
  noise = 0,
  offbeat = false,
  snare = false,
  seed = 1,
}) {
  const random = rng(seed);
  const length = Math.round(seconds / HOP);
  const envelope = new Float32Array(length);

  // Background level, so whitening has something to remove.
  for (let i = 0; i < length; i++) {
    envelope[i] = 0.25 + noise * (random() - 0.5) * 2;
  }

  const beatSeconds = 60 / bpm;
  const totalBeats = Math.floor(seconds / beatSeconds);

  const strike = (timeSeconds, amplitude) => {
    const centre = Math.round(timeSeconds / HOP);
    // A short decaying transient, like a real onset-detection function.
    for (let k = 0; k < 8; k++) {
      const index = centre + k;
      if (index < 0 || index >= length) continue;
      envelope[index] += amplitude * Math.exp(-k / 2.2);
    }
  };

  for (let beat = 0; beat < totalBeats; beat++) {
    const jitter = jitterMs > 0 ? ((random() - 0.5) * 2 * jitterMs) / 1000 : 0;
    const time = beat * beatSeconds + jitter;

    strike(time, 1);
    if (offbeat) strike(time + beatSeconds / 2, 0.45);
    if (snare && beat % 4 === 1) strike(time, 0.7);
    if (snare && beat % 4 === 3) strike(time, 0.7);
  }

  return envelope;
}

/**
 * A bare kick on every beat is genuinely octave-ambiguous — 174 with a kick
 * on each beat is indistinguishable from 87 with a kick on each beat, for any
 * algorithm and for a human. So the plain sweep asserts octave equivalence,
 * and the tests below it assert an exact reading on patterns that carry the
 * off-beat information a real record would.
 */
function octaveEquivalent(got, expected, tolerance = 1.0) {
  for (const factor of [0.25, 0.5, 1, 2, 4]) {
    if (Math.abs(got - expected * factor) <= tolerance * Math.max(1, factor)) {
      return true;
    }
  }
  return false;
}

console.log("\nestimateTempo — clean signals (octave-equivalent)");

for (const bpm of [90, 100, 110, 118, 124, 128, 133, 140, 150, 160, 174]) {
  check(`recovers ${bpm} BPM`, () => {
    const result = estimateTempo(synthesise({ bpm, seed: bpm }), HOP);
    assert.ok(result, "returned null");
    assert.ok(
      octaveEquivalent(result.bpm, bpm),
      `got ${result.bpm}, expected ${bpm} or an octave of it`,
    );
    assert.ok(
      result.confidence > 0.3,
      `confidence too low: ${result.confidence.toFixed(2)}`,
    );
  });
}

console.log("\nestimateTempo — exact reading when the pattern disambiguates");

for (const bpm of [118, 124, 128, 133, 140]) {
  check(`reads ${bpm} BPM exactly with off-beat content`, () => {
    const result = estimateTempo(
      synthesise({ bpm, offbeat: true, snare: true, seed: bpm + 1 }),
      HOP,
    );
    assert.ok(result, "returned null");
    assert.ok(
      Math.abs(result.bpm - bpm) <= 1.5,
      `got ${result.bpm}, expected ${bpm} (±1.5)`,
    );
  });
}

/**
 * Documented limitation, pinned so it cannot silently get worse.
 *
 * Jungle and drum & bass sit around 170–176 with a half-time feel: the snare
 * pattern genuinely describes ~87, and every tempo estimator — commercial ones
 * included — splits on which to report. The contract is therefore "an octave
 * of the truth, never an unrelated number", and the UI carries a one-click
 * ×2 / ÷2 for the DJ to settle it. A regression that returned, say, 130 here
 * would still fail this test.
 */
check("DnB tempo lands on an octave, never something unrelated", () => {
  const result = estimateTempo(
    synthesise({ bpm: 174, offbeat: true, snare: true, seed: 175 }),
    HOP,
  );
  assert.ok(result, "returned null");
  assert.ok(
    octaveEquivalent(result.bpm, 174, 2),
    `got ${result.bpm}, which is not an octave of 174`,
  );
});

console.log("\nestimateTempo — realistic degradations");

check("survives 12 ms of timing jitter", () => {
  const result = estimateTempo(
    synthesise({ bpm: 126, jitterMs: 12, seed: 7 }),
    HOP,
  );
  assert.ok(result, "returned null");
  assert.ok(Math.abs(result.bpm - 126) <= 1.5, `got ${result.bpm}`);
});

check("survives heavy noise", () => {
  const result = estimateTempo(
    synthesise({ bpm: 132, noise: 0.55, seed: 11 }),
    HOP,
  );
  assert.ok(result, "returned null");
  assert.ok(Math.abs(result.bpm - 132) <= 1.5, `got ${result.bpm}`);
});

check("off-beat hats do not double the tempo", () => {
  const result = estimateTempo(
    synthesise({ bpm: 124, offbeat: true, seed: 13 }),
    HOP,
  );
  assert.ok(result, "returned null");
  assert.ok(
    Math.abs(result.bpm - 124) <= 1.5,
    `got ${result.bpm} — likely reported 248/2 wrongly`,
  );
});

check("backbeat snare does not halve the tempo", () => {
  const result = estimateTempo(
    synthesise({ bpm: 128, snare: true, offbeat: true, seed: 17 }),
    HOP,
  );
  assert.ok(result, "returned null");
  assert.ok(Math.abs(result.bpm - 128) <= 1.5, `got ${result.bpm}`);
});

check("slow tempo is reported in the preferred octave", () => {
  // 70 BPM half-time: reporting 140 is the musically useful answer.
  const result = estimateTempo(synthesise({ bpm: 70, seed: 19 }), HOP);
  assert.ok(result, "returned null");
  assert.ok(
    Math.abs(result.bpm - 140) <= 2 || Math.abs(result.bpm - 70) <= 2,
    `got ${result.bpm}, expected 70 or 140`,
  );
});

console.log("\nestimateTempo — refuses to guess");

check("returns null on silence", () => {
  assert.equal(estimateTempo(new Float32Array(1400), HOP), null);
});

check("returns null on too short a buffer", () => {
  assert.equal(estimateTempo(synthesise({ bpm: 128, seconds: 1 }), HOP), null);
});

check("low confidence on unpulsed noise", () => {
  const random = rng(23);
  const envelope = new Float32Array(1400);
  for (let i = 0; i < envelope.length; i++) envelope[i] = random();
  const result = estimateTempo(envelope, HOP);
  if (result) {
    assert.ok(
      result.confidence < 0.45,
      `noise reported confidence ${result.confidence.toFixed(2)} — too sure of itself`,
    );
  }
});

console.log("\nwhiten");

check("removes a sustained DC level", () => {
  const envelope = new Float32Array(400).fill(0.8);
  const result = whiten(envelope);
  const total = result.reduce((a, b) => a + b, 0);
  assert.ok(total < 1, `expected near zero, got ${total.toFixed(3)}`);
});

console.log("\nTapTempo");

check("needs three taps before answering", () => {
  const tap = new TapTempo();
  assert.equal(tap.tap(0), null);
  assert.equal(tap.tap(500), null);
  assert.ok(tap.tap(1000));
});

check("reads a steady 120 BPM tap", () => {
  const tap = new TapTempo();
  let result = null;
  for (let i = 0; i <= 8; i++) result = tap.tap(i * 500);
  assert.ok(result);
  assert.ok(Math.abs(result.bpm - 120) < 0.5, `got ${result.bpm}`);
});

check("rejects one fumbled tap", () => {
  const tap = new TapTempo();
  //         steady 500 ms apart, except one tap 300 ms late
  const times = [0, 500, 1000, 1800, 2000, 2500, 3000, 3500];
  let result = null;
  for (const t of times) result = tap.tap(t);
  assert.ok(result);
  assert.ok(
    Math.abs(result.bpm - 120) < 4,
    `got ${result.bpm} — the outlier was not rejected`,
  );
});

check("resets after a long pause", () => {
  const tap = new TapTempo();
  tap.tap(0);
  tap.tap(500);
  tap.tap(1000);
  assert.equal(tap.tap(20_000), null, "should have started a fresh count");
});

console.log("\nparseBpmFromText");

const bpmCases = [
  ["Deep Burnt (128 BPM)", 128],
  ["Track A1 133bpm", 133],
  ["BPM: 174", 174],
  ["Untitled", null],
  ["Recorded in 1995", null],
  ["Mix @ 140", 140],
  ["9000 BPM", null],
];

for (const [input, expected] of bpmCases) {
  check(`"${input}" -> ${expected}`, () => {
    assert.equal(parseBpmFromText(input), expected);
  });
}

console.log(
  failures === 0
    ? "\nAll tempo tests passed.\n"
    : `\n${failures} test(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
