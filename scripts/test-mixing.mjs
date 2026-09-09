#!/usr/bin/env node
/**
 * Mixability tests.
 *
 * The maths here decides whether a DJ carries a record to a gig, so it is
 * worth pinning hard. Cases are written against real tempos and checked
 * against hand-computed answers rather than against the implementation.
 *
 *   npm run test:mixing
 */

import { strict as assert } from "node:assert";
import {
  analyseSequence,
  checkMix,
  meetingBpm,
  mixableWindow,
  requiredPitchPercent,
  smoothOrder,
  DEFAULT_PITCH_PERCENT,
  setLength,
  formatSetLength,
} from "../src/lib/mixing.ts";

let failures = 0;
let ran = 0;

function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

const near = (actual, expected, tolerance, what) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: got ${actual}, expected ${expected} (±${tolerance})`,
  );

console.log("\nthe closed form");

check("identical tempos need no pitch", () => {
  assert.equal(requiredPitchPercent(124, 124), 0);
});

check("124 → 128 needs 1.587% each way", () => {
  // |128-124| / (124+128) = 4/252 = 0.015873
  near(requiredPitchPercent(124, 128), 1.5873, 0.001, "required");
});

check("124 → 140 needs 6.06% each way", () => {
  // 16/264
  near(requiredPitchPercent(124, 140), 6.0606, 0.001, "required");
});

check("the meeting tempo is the harmonic mean", () => {
  near(meetingBpm(124, 128), 125.968, 0.01, "meet");
  // and it is reachable from both sides by the same pitch
  const x = requiredPitchPercent(124, 128) / 100;
  near(124 * (1 + x), 125.968, 0.01, "from below");
  near(128 * (1 - x), 125.968, 0.01, "from above");
});

check("the check is symmetric", () => {
  near(
    requiredPitchPercent(128, 124),
    requiredPitchPercent(124, 128),
    0.0001,
    "symmetry",
  );
});

console.log("\n±8% — a Technics SL-1200");

check("124 → 128 mixes directly", () => {
  const result = checkMix(124, 128, 8);
  assert.equal(result.verdict, "direct");
  assert.equal(result.ratio, 1);
  near(result.meetBpm, 126, 0.1, "meet");
  near(Math.abs(result.outgoingPitch), 1.6, 0.1, "pitch each");
});

check("124 → 140 still mixes, but you will hear it", () => {
  const result = checkMix(124, 140, 8);
  assert.equal(result.verdict, "direct");
  near(result.requiredPercent, 6.1, 0.1, "required");
});

check("124 → 150 does not fit on a 1200", () => {
  const result = checkMix(124, 150, 8);
  // 26/274 = 9.49%
  assert.equal(result.verdict, "stretch");
  near(result.requiredPercent, 9.5, 0.1, "required");
});

check("both decks pitching is what makes 124 → 140 work", () => {
  // Holding the outgoing record at zero, the incoming one alone would need
  // 124/140 - 1 = -11.4%, which is outside ±8. Meeting in the middle is 6.1%.
  const result = checkMix(124, 140, 8);
  near(Math.abs(result.incomingOnlyPitch), 11.4, 0.2, "one-sided");
  assert.ok(
    Math.abs(result.incomingOnlyPitch) > 8,
    "the one-sided move should be out of range — that is the point of the test",
  );
  assert.equal(result.verdict, "direct", "meeting in the middle should rescue it");
});

console.log("\nhalf and double time");

check("87 → 174 is a double-time fit with no pitch at all", () => {
  const result = checkMix(87, 174, 8);
  assert.ok(
    result.verdict === "half-time" || result.verdict === "double-time",
    `expected a time-shifted fit, got ${result.verdict}`,
  );
  near(result.requiredPercent, 0, 0.01, "required");
});

check("174 → 87 works the same way round", () => {
  const result = checkMix(174, 87, 8);
  assert.ok(
    result.verdict === "half-time" || result.verdict === "double-time",
    `got ${result.verdict}`,
  );
  near(result.requiredPercent, 0, 0.01, "required");
});

check("a near-double still fits: 86 → 174", () => {
  // 172 vs 174 → 2/346 = 0.578%
  const result = checkMix(86, 174, 8);
  assert.ok(["half-time", "double-time"].includes(result.verdict), result.verdict);
  near(result.requiredPercent, 0.58, 0.05, "required");
});

check("a 1:1 fit is preferred over a time-shifted one", () => {
  const result = checkMix(124, 126, 8);
  assert.equal(result.verdict, "direct");
  assert.equal(result.ratio, 1);
});

console.log("\nwider ranges");

check("124 → 150 fits once you allow ±16", () => {
  const result = checkMix(124, 150, 16);
  assert.equal(result.verdict, "direct");
});

check("90 → 128 is impossible on any normal deck", () => {
  // Straight 1:1 would be 38/218 = 17.43%. But counting the 128 at half-time
  // (64) gives 26/154 = 16.88%, which is cheaper — so that is the number the
  // checker reports. This case is here because the author's first hand
  // calculation missed the half-time route entirely and the test caught it.
  const result = checkMix(90, 128, 8);
  assert.equal(result.verdict, "impossible");
  near(result.requiredPercent, 16.88, 0.05, "required");
  assert.equal(result.ratio, 0.5, "should have found the half-time route");
});

check("the cheapest of the three ratios always wins", () => {
  // 1:1 needs 16.67%, half-time needs 17.6%, double-time 47%.
  const result = checkMix(100, 140, 8);
  assert.equal(result.ratio, 1);
  near(result.requiredPercent, 16.67, 0.05, "required");
  assert.equal(result.verdict, "impossible", "16.67% is past the ±16 ceiling");
});

check("a tighter deck rejects what a 1200 accepts", () => {
  assert.equal(checkMix(124, 140, 8).verdict, "direct");
  assert.equal(checkMix(124, 140, 6).verdict, "stretch");
});

console.log("\nunknowns");

for (const [a, b] of [
  [null, 128],
  [124, null],
  [null, null],
  [0, 128],
]) {
  check(`(${a}, ${b}) is reported as unknown, never guessed`, () => {
    const result = checkMix(a, b, 8);
    assert.equal(result.verdict, "unknown");
    assert.equal(result.meetBpm, null);
  });
}

console.log("\nthe mixable window");

check("±8% around 124 is 105.6–145.7, not 114–134", () => {
  const window = mixableWindow(124, 8);
  near(window.low, 105.6, 0.2, "low");
  near(window.high, 145.7, 0.2, "high");
});

check("the window edges are exactly the fit boundary", () => {
  const window = mixableWindow(124, 8);
  assert.equal(checkMix(124, window.high - 0.2, 8).verdict, "direct");
  assert.equal(checkMix(124, window.low + 0.2, 8).verdict, "direct");
  assert.notEqual(checkMix(124, window.high + 2, 8).verdict, "direct");
  assert.notEqual(checkMix(124, window.low - 2, 8).verdict, "direct");
});

check("the window scales with the pitch range", () => {
  const narrow = mixableWindow(124, 6);
  const wide = mixableWindow(124, 16);
  assert.ok(wide.low < narrow.low && wide.high > narrow.high);
});

console.log("\nsequence analysis");

check("a smooth set reports all direct", () => {
  const report = analyseSequence([122, 124, 126, 128, 130], 8);
  assert.equal(report.steps.length, 4);
  assert.equal(report.direct, 4);
  assert.equal(report.impossible, 0);
  assert.deepEqual(report.problemIndices, []);
});

check("a bad jump is flagged at the right index", () => {
  //                0    1    2     3
  const report = analyseSequence([124, 126, 90, 128], 8);
  assert.ok(report.problemIndices.includes(2), "126 → 90 should be flagged");
  assert.ok(report.problemIndices.includes(3), "90 → 128 should be flagged");
  assert.ok(!report.problemIndices.includes(1), "124 → 126 is fine");
});

check("a missing BPM counts as unknown, not as a problem", () => {
  const report = analyseSequence([124, null, 128], 8);
  assert.equal(report.unknown, 2);
  assert.deepEqual(report.problemIndices, []);
});

check("double-time transitions are counted separately", () => {
  const report = analyseSequence([87, 174, 172], 8);
  assert.equal(report.timeShifted, 1);
  assert.equal(report.direct, 1);
});

check("an empty or single-track playlist has no transitions", () => {
  assert.equal(analyseSequence([], 8).steps.length, 0);
  assert.equal(analyseSequence([128], 8).steps.length, 0);
});

console.log("\nsmooth ordering");

check("scrambled tempos come back climbing", () => {
  const bpms = [140, 122, 131, 126, 135];
  const order = smoothOrder(bpms, 8);
  assert.equal(order.length, bpms.length);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4]);

  const reordered = order.map((i) => bpms[i]);
  const report = analyseSequence(reordered, 8);
  assert.equal(
    report.impossible + report.stretch,
    0,
    `reordering left ${report.impossible + report.stretch} bad transitions: ${reordered}`,
  );
});

check("reordering never loses or duplicates a track", () => {
  const bpms = [128, null, 96, 174, 124, null, 132];
  const order = smoothOrder(bpms, 8);
  assert.equal(order.length, bpms.length);
  assert.equal(new Set(order).size, bpms.length, "duplicated an index");
});

check("tracks without a BPM are pushed to the end, not interleaved", () => {
  const bpms = [128, null, 124, null, 126];
  const order = smoothOrder(bpms, 8);
  const tail = order.slice(-2).map((i) => bpms[i]);
  assert.deepEqual(tail, [null, null]);
});

check("ordering improves a deliberately terrible sequence", () => {
  const bpms = [174, 96, 128, 100, 132, 92, 170];
  const before = analyseSequence(bpms, 8);
  const after = analyseSequence(smoothOrder(bpms, 8).map((i) => bpms[i]), 8);
  assert.ok(
    after.impossible + after.stretch < before.impossible + before.stretch,
    `no improvement: ${before.impossible + before.stretch} → ${after.impossible + after.stretch}`,
  );
});

console.log("\ndefaults");

check("the default pitch range is the Technics ±8", () => {
  assert.equal(DEFAULT_PITCH_PERCENT, 8);
  assert.deepEqual(checkMix(124, 128), checkMix(124, 128, 8));
});

/* -- set length ---------------------------------------------------------- */

check("no tracks is a zero-length set", () => {
  const s = setLength([], 30);
  assert.equal(s.playedSeconds, 0);
  assert.equal(s.trackCount, 0);
  assert.equal(s.partial, false);
});

check("one track has no transition to subtract", () => {
  // The off-by-one that matters: n-1 gaps, never n.
  const s = setLength([300], 30);
  assert.equal(s.rawSeconds, 300);
  assert.equal(s.playedSeconds, 300);
});

check("two tracks share one transition", () => {
  const s = setLength([300, 300], 30);
  assert.equal(s.playedSeconds, 570);
});

check("ten tracks subtract nine transitions", () => {
  const s = setLength(Array(10).fill(360), 30);
  assert.equal(s.playedSeconds, 3600 - 9 * 30);
});

check("a zero transition is a straight sum", () => {
  assert.equal(setLength([300, 300, 300], 0).playedSeconds, 900);
});

check("a blend cannot exceed the records it joins", () => {
  // 90s requested across two 60s tracks: the overlap is capped at 60, so the
  // pair runs 60s, not the -60s a flat subtraction would produce.
  const s = setLength([60, 60], 90);
  assert.equal(s.playedSeconds, 60);
});

check("a short track only shortens its own two transitions", () => {
  // 300, 40, 300 with a 45s blend. Both gaps touch the 40s track, so both are
  // capped at 40 — total overlap 80, not 90.
  const s = setLength([300, 40, 300], 45);
  assert.equal(s.rawSeconds, 640);
  assert.equal(s.playedSeconds, 640 - 80);
});

check("never negative, whatever the settings", () => {
  assert.ok(setLength([10, 10, 10], 90).playedSeconds >= 0);
});

check("untimed tracks are flagged, not guessed", () => {
  const s = setLength([300, null, 300, undefined], 0);
  assert.equal(s.rawSeconds, 600);
  assert.equal(s.trackCount, 4);
  assert.equal(s.timedCount, 2);
  assert.equal(s.partial, true);
});

check("a fully timed set is not partial", () => {
  assert.equal(setLength([300, 300], 30).partial, false);
});

check("zero and negative runtimes do not count as timed", () => {
  const s = setLength([300, 0, -5], 0);
  assert.equal(s.rawSeconds, 300);
  assert.equal(s.timedCount, 1);
  assert.equal(s.partial, true);
});

check("untimed tracks still consume a transition slot", () => {
  // Four tracks are three gaps whether or not we know their runtimes.
  const s = setLength([600, null, 600, null], 30);
  assert.equal(s.playedSeconds, 1200 - 3 * 30);
});

check("a realistic two-hour set", () => {
  // 20 tracks at 6:30, blended for 35s: 7800 - 19x35 = 7135s.
  const s = setLength(Array(20).fill(390), 35);
  assert.equal(s.rawSeconds, 7800);
  assert.equal(s.playedSeconds, 7135);
  assert.equal(formatSetLength(s.playedSeconds), "1h 59m");
});

check("formatSetLength reads like a set, not a stopwatch", () => {
  assert.equal(formatSetLength(0), "0m");
  assert.equal(formatSetLength(59), "1m");
  assert.equal(formatSetLength(60 * 48), "48m");
  assert.equal(formatSetLength(3600), "1h");
  assert.equal(formatSetLength(3600 + 24 * 60), "1h 24m");
});

check("formatSetLength rolls 60 minutes into the next hour", () => {
  assert.equal(formatSetLength(3600 + 59 * 60 + 30), "2h");
});

check("formatSetLength never renders a negative", () => {
  assert.equal(formatSetLength(-500), "0m");
});

console.log(
  failures === 0
    ? `\nAll ${ran} mixing tests passed.\n`
    : `\n${failures} of ${ran} mixing tests failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
