/**
 * Beat meter tests.
 *
 *   npm run test:beat-meter
 *
 * The meter is the only feedback that detection is working during the first
 * eight seconds, so the arithmetic that places a kick on screen, scales it,
 * and says how long is left is worth pinning.
 */
import assert from "node:assert/strict";
import {
  bucketOnsets,
  bufferedSeconds,
  meterPhase,
  nextPeak,
  scaleBars,
  warmupLabel,
  warmupProgress,
  METER_BARS,
  METER_SPAN_SECONDS,
  PEAK_DECAY_PER_FRAME,
} from "../src/client/beatMeter.ts";

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

/** A steady kick: a spike every beat, quiet in between, sampled at 125 Hz. */
function kicks({ bpm, seconds, start = 0 }) {
  const out = [];
  const beat = 60 / bpm;
  for (let t = start; t < start + seconds; t += 0.008) {
    const phase = ((t - start) % beat) / beat;
    out.push({ t, v: phase < 0.04 ? 10 : 0.2 });
  }
  return out;
}

/* ---- placing onsets ---- */

check("the newest sample lands in the last bar", () => {
  const bars = bucketOnsets([{ t: 9.999, v: 5 }], 10, 10, 3);
  assert.equal(bars[9], 5);
  assert.equal(bars.slice(0, 9).every((v) => v === 0), true);
});

check("the oldest visible sample lands in the first bar", () => {
  const bars = bucketOnsets([{ t: 7.001, v: 4 }], 10, 10, 3);
  assert.equal(bars[0], 4);
});

check("anything older than the window is ignored", () => {
  const bars = bucketOnsets([{ t: 6.9, v: 99 }], 10, 10, 3);
  assert.deepEqual(bars, new Array(10).fill(0));
});

check("a bar keeps its loudest sample, not the average", () => {
  // Averaging a kick against the silence around it is how a beat meter ends
  // up looking like a flat hum.
  const bars = bucketOnsets(
    [{ t: 9.0, v: 0.1 }, { t: 9.01, v: 8 }, { t: 9.02, v: 0.1 }],
    10,
    3,
    3,
  );
  assert.equal(Math.max(...bars), 8);
});

check("a steady kick shows as evenly spaced spikes", () => {
  // 120 BPM over three seconds is six beats; the meter should show about six
  // clear spikes, which is the whole point of drawing it.
  const samples = kicks({ bpm: 120, seconds: 10 });
  const bars = bucketOnsets(samples, samples.at(-1).t, METER_BARS, METER_SPAN_SECONDS);
  const spikes = bars.filter((v) => v > 5).length;
  assert.ok(spikes >= 5 && spikes <= 7, `${spikes} spikes`);
});

check("an empty buffer draws a flat meter, not an error", () => {
  assert.deepEqual(bucketOnsets([], 10, 4, 3), [0, 0, 0, 0]);
  assert.deepEqual(bucketOnsets([{ t: 1, v: 1 }], 10, 0, 3), []);
});

/* ---- scaling ---- */

check("the peak jumps up at once and falls slowly", () => {
  assert.equal(nextPeak(1, 5), 5);
  const after = nextPeak(5, 0);
  assert.ok(after < 5 && after > 4.9, `${after}`);
  assert.equal(PEAK_DECAY_PER_FRAME, 0.985);
});

check("the peak never reaches zero, so scaling never divides by it", () => {
  let peak = 1;
  for (let i = 0; i < 10_000; i++) peak = nextPeak(peak, 0);
  assert.ok(peak > 0);
});

check("heights stay between 0 and 1", () => {
  const heights = scaleBars([-1, 0, 2, 5, 50], 5);
  assert.ok(heights.every((h) => h >= 0 && h <= 1), heights.join());
  assert.equal(heights[3], 1);
});

check("quiet onsets are lifted so they still register beside the kick", () => {
  // A hat at a quarter of the kick's strength shows at half height, not a
  // quarter: the hats are what tell a tempo from its double.
  const [hat, kick] = scaleBars([1, 4], 4);
  assert.equal(kick, 1);
  assert.equal(hat, 0.5);
});

/* ---- warming up ---- */

check("buffered time comes from the samples' own clock", () => {
  assert.equal(bufferedSeconds([]), 0);
  assert.equal(bufferedSeconds([{ t: 2, v: 0 }]), 0);
  assert.equal(bufferedSeconds([{ t: 2, v: 0 }, { t: 5.5, v: 0 }]), 3.5);
});

check("warm-up runs from 0 to 1 and stops there", () => {
  assert.equal(warmupProgress([], 8), 0);
  assert.equal(warmupProgress([{ t: 0, v: 0 }, { t: 4, v: 0 }], 8), 0.5);
  assert.equal(warmupProgress([{ t: 0, v: 0 }, { t: 30, v: 0 }], 8), 1);
});

check("the label counts down, then says it is reading", () => {
  assert.equal(warmupLabel([{ t: 0, v: 0 }, { t: 2.2, v: 0 }], 8), "listening · 6s");
  assert.equal(warmupLabel([{ t: 0, v: 0 }, { t: 8.4, v: 0 }], 8), "reading the beat…");
});

/* ---- phase ---- */

check("the phase walks warming → reading → live → locked", () => {
  assert.equal(meterPhase(0.3, false, false), "warming");
  assert.equal(meterPhase(1, false, false), "reading");
  assert.equal(meterPhase(1, true, false), "live");
  assert.equal(meterPhase(1, true, true), "locked");
});

check("a saved reading wins even if the rolling one has gone", () => {
  assert.equal(meterPhase(0, false, true), "locked");
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} beat meter tests failed.`);
  process.exit(1);
}
console.log(`\nAll ${ran} beat meter tests passed.`);
