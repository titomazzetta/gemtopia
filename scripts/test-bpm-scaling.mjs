/**
 * BPM scaling tests.
 *
 *   npm run test:bpm-scale
 *
 * The ÷2 / ×2 control exists because tempo detection cannot tell an octave
 * apart — a jungle record at 170 is heard as 85 about as often as not. The
 * arithmetic and the limits are the only things the code has to get right,
 * and both lived inside a 2,400-line component where nothing could check
 * them.
 */
import assert from "node:assert/strict";
import {
  scaleReading,
  MIN_BPM,
  MAX_BPM,
} from "../src/client/bpmScaling.ts";

let ran = 0;
let failed = 0;

function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

check("the case this control exists for: half-time jungle", () => {
  assert.equal(scaleReading(85, 2).bpm, 170);
  assert.equal(scaleReading(170, 0.5).bpm, 85);
});

check("a fractional reading rounds to one decimal place", () => {
  // 86.25 * 2 is 172.5 exactly, but floating point does not always agree.
  assert.equal(scaleReading(86.25, 2).bpm, 172.5);
  assert.equal(scaleReading(87.35, 2).bpm, 174.7);
});

check("doubling never produces a float artefact", () => {
  for (let bpm = 40; bpm <= 130; bpm += 0.05) {
    const { bpm: out } = scaleReading(Math.round(bpm * 100) / 100, 2);
    if (out === null) continue;
    assert.equal(
      out,
      Math.round(out * 10) / 10,
      `${bpm} doubled to an unrounded ${out}`,
    );
  }
});

/* ---- the limits ---- */

check("a result below the floor is refused, not clamped", () => {
  // Clamping would record a tempo nobody measured, in a catalogue used to
  // decide whether two records beatmatch.
  const result = scaleReading(60, 0.5);
  assert.equal(result.bpm, null);
  assert.match(result.refusal, /sensible tempo range/);
});

check("a result above the ceiling is refused, not clamped", () => {
  const result = scaleReading(200, 2);
  assert.equal(result.bpm, null);
  assert.ok(result.refusal);
});

check("the refusal names the number that was rejected", () => {
  // "That would land outside a sensible range" leaves you guessing what it
  // computed; the number tells you whether it did what you expected.
  assert.match(scaleReading(200, 2).refusal, /400/);
});

check("the boundaries themselves are allowed", () => {
  assert.equal(scaleReading(MIN_BPM * 2, 0.5).bpm, MIN_BPM);
  assert.equal(scaleReading(MAX_BPM / 2, 2).bpm, MAX_BPM);
});

/* ---- nothing to scale ---- */

check("an unmeasured track is a no-op, not a refusal", () => {
  // There is no error here — you pressed halve on a track with no reading.
  // A refusal message would be noise.
  for (const nothing of [null, undefined, NaN, Infinity]) {
    const result = scaleReading(nothing, 2);
    assert.equal(result.bpm, null);
    assert.equal(result.refusal, null, `${String(nothing)} produced a message`);
  }
});

check("halving then doubling returns the original, where it can", () => {
  // Exact for anything whose half is representable at one decimal place,
  // which is every whole BPM and most fractional ones.
  for (const bpm of [128, 140, 174, 86.4]) {
    const halved = scaleReading(bpm, 0.5).bpm;
    assert.equal(scaleReading(halved, 2).bpm, bpm, `${bpm} did not round-trip`);
  }
});

check("a reading whose half is not representable drifts at most 0.1, once", () => {
  /*
   * 87.5 halves to 43.75, which one decimal place cannot hold, so it stores
   * 43.8 and doubles back to 87.6. Measured rather than assumed: the drift is
   * bounded at 0.1 BPM and settles on the *first* round trip — pressing the
   * control repeatedly does not walk the number away.
   *
   * 0.1 at 87.5 is 0.11%, against a pitch range of 8%. Storing more precision
   * to chase it would be a change to every reading in the catalogue in
   * service of a number no fader can express. The behaviour is pinned here
   * instead so a future change to the rounding has to argue with a test.
   */
  for (const start of [87.5, 174.5, 128.25]) {
    const seen = [start];
    let value = start;
    for (let i = 0; i < 5; i += 1) {
      const halved = scaleReading(value, 0.5).bpm;
      if (halved === null) break;
      const doubled = scaleReading(halved, 2).bpm;
      if (doubled === null) break;
      value = doubled;
      seen.push(value);
    }

    const drift = Math.max(...seen) - Math.min(...seen);
    assert.ok(drift <= 0.1 + 1e-9, `${start} drifted ${drift}`);

    // Settled: everything after the first round trip is identical.
    const settled = seen.slice(1);
    assert.ok(
      settled.every((v) => v === settled[0]),
      `${start} kept moving: ${seen.join(" -> ")}`,
    );
  }
});

console.log(`\n${ran - failed}/${ran} BPM scaling tests passed.`);
if (failed > 0) process.exit(1);
