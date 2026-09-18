/**
 * Stall watchdog tests.
 *
 *   npm run test:watchdog
 *
 * Reported from a phone: four tracks from one EP showed YouTube's own "This
 * video is unavailable" card and the player sat at 0:00 forever. The error
 * handler never fired — YouTube draws that card without reporting anything —
 * and nothing timed out, because onStateChange handled ENDED, PLAYING, PAUSED
 * and BUFFERING and ignored UNSTARTED and CUED.
 *
 * So this rule is about *time*, not reasons. A dead upload, a region block, an
 * autoplay refusal and a network that vanished all look identical from here
 * and all deserve the same answer: say so, move on.
 */
import assert from "node:assert/strict";
import {
  watchdogAction,
  describeStall,
  PLAYER_STATE,
  START_TIMEOUT_MS,
} from "../src/client/playbackWatchdog.ts";

let ran = 0, failed = 0;
const check = (n, f) => { ran += 1; try { f(); } catch (e) { failed += 1; console.error(`FAIL  ${n}\n      ${e.message}`); } };

/* ---- the states that were being ignored ---- */

check("UNSTARTED keeps the deadline running", () => {
  // The bug. A clip that never starts sits in UNSTARTED, and nothing was
  // watching, so the app waited forever.
  assert.equal(watchdogAction(PLAYER_STATE.UNSTARTED), "keep");
});

check("CUED keeps the deadline running", () => {
  assert.equal(watchdogAction(PLAYER_STATE.CUED), "keep");
});

/* ---- the states that mean it worked ---- */

check("PLAYING stops the watch", () => {
  assert.equal(watchdogAction(PLAYER_STATE.PLAYING), "clear");
});

check("PAUSED counts as started, not as stuck", () => {
  // The video loaded and something paused it — the user, or an autoplay
  // policy. Either way it is present and playable, and skipping it would
  // throw away a clip that works.
  assert.equal(watchdogAction(PLAYER_STATE.PAUSED), "clear");
});

check("ENDED stops the watch", () => {
  // A very short clip can end before anything else is observed.
  assert.equal(watchdogAction(PLAYER_STATE.ENDED), "clear");
});

/* ---- slow is not stuck ---- */

check("BUFFERING extends rather than clearing or killing", () => {
  // A basement record shop on bad wifi must not look like a dead upload.
  assert.equal(watchdogAction(PLAYER_STATE.BUFFERING), "extend");
});

check("repeated buffering can never trip the watchdog", () => {
  // Each extend restarts the full window, so a clip that keeps buffering
  // keeps getting time. This is a budget for silence, not for loading.
  for (let i = 0; i < 50; i += 1) {
    assert.equal(watchdogAction(PLAYER_STATE.BUFFERING), "extend");
  }
});

/* ---- unknown states ---- */

check("a state YouTube adds later does not clear the watch", () => {
  // Defaulting to "clear" would silently disable the watchdog the day the
  // API grows a state. Waiting is not progress.
  for (const unknown of [4, 6, 99, -2]) {
    assert.equal(watchdogAction(unknown), "keep", `state ${unknown} cleared the watch`);
  }
});

/* ---- the message ---- */

check("the stall message names the record", () => {
  assert.match(describeStall("Towerskull"), /Towerskull/);
});

check("the message blames the upload, not the record", () => {
  // The pressing is fine and the record is fine; it is the YouTube upload
  // Discogs points at that has gone.
  const message = describeStall("Towerskull");
  assert.match(message, /YouTube/);
  assert.ok(!/error \d+/.test(message), "invented an error code on the path that has none");
});

check("a missing title does not produce a sentence starting with a space", () => {
  for (const blank of ["", "   "]) {
    assert.match(describeStall(blank), /^That clip /);
  }
});

/* ---- the window ---- */

check("the window is eight seconds", () => {
  // Pinned because it is a judgement: long enough that a slow connection is
  // not mistaken for a dead video, short enough that you are not left
  // watching a track that will never play.
  assert.equal(START_TIMEOUT_MS, 8_000);
});

console.log(`\n${ran - failed}/${ran} watchdog tests passed.`);
if (failed > 0) process.exit(1);
