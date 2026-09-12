/**
 * Scrubber position tests.
 *
 *   npm run test:scrub
 *
 * The cases that matter are the degenerate ones. A YouTube player reports a
 * duration of 0 until metadata arrives, and NaN if the video is unplayable;
 * either one reaching the maths as a divisor produces a thumb at NaN, which
 * React renders as an uncontrolled input and the slider silently stops
 * tracking the track.
 */
import assert from "node:assert/strict";
import { positionOf, secondsOf, SCRUB_STEPS } from "../src/client/scrub.ts";

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

check("the start of a track is position zero", () => {
  assert.equal(positionOf(0, 300), 0);
});
check("halfway is halfway", () => {
  assert.equal(positionOf(150, 300), 500);
});
check("the end reaches the end of the track", () => {
  assert.equal(positionOf(300, 300), SCRUB_STEPS);
});
check("a duration of zero is position zero, not NaN", () => {
  assert.equal(positionOf(42, 0), 0);
});
check("NaN and Infinity never reach the thumb", () => {
  for (const bad of [NaN, Infinity, -1]) {
    assert.equal(positionOf(10, bad), 0, `duration ${bad}`);
    assert.equal(positionOf(bad, 300), 0, `currentTime ${bad}`);
  }
});
check("a currentTime past the duration cannot overshoot", () => {
  assert.equal(positionOf(400, 300), SCRUB_STEPS);
});

check("position zero seeks to the start", () => {
  assert.equal(secondsOf(0, 300), 0);
});
check("the midpoint seeks to the midpoint", () => {
  assert.equal(secondsOf(500, 300), 150);
});
check("the far end seeks to the duration, never past it", () => {
  assert.equal(secondsOf(SCRUB_STEPS, 300), 300);
  assert.equal(secondsOf(9999, 300), 300);
});
check("a negative position clamps to the start", () => {
  assert.equal(secondsOf(-50, 300), 0);
});
check("an unknown duration seeks nowhere", () => {
  for (const bad of [0, NaN, -3]) assert.equal(secondsOf(500, bad), 0, `duration ${bad}`);
});
check("round trips land back where they started", () => {
  for (const seconds of [0, 1, 37, 150, 299, 300]) {
    const back = secondsOf(positionOf(seconds, 300), 300);
    assert.ok(Math.abs(back - seconds) < 0.5, `${seconds} -> ${back}`);
  }
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} scrub tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} scrub tests passed.`);
