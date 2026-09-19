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
 * The rule for *when* to give up is about time, not reasons: a dead upload, a
 * region block and a network that vanished all look identical from here.
 *
 * What to do afterwards is not. The header `autoplay=(self)` refused every
 * clip in the collection for months, and on that build this watchdog would
 * have blamed each record in turn and skipped it — walking the whole crate at
 * one record per eight seconds while the cause sat in a response header. So
 * the verdict now distinguishes "this upload is gone" from "this browser will
 * not let us press play", and only the first one advances.
 */
import assert from "node:assert/strict";
import {
  watchdogAction,
  describeStall,
  describeBlockedPlay,
  playOutcome,
  shouldSkipOnStall,
  stallVerdict,
  PLAY_CONFIRM_MS,
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

/* ---- whose fault it was ---- */

check("a blocked browser is not the record's fault", () => {
  assert.equal(stallVerdict(true), "unavailable");
  assert.equal(stallVerdict(false), "blocked");
});

check("only a dead upload advances the queue", () => {
  // The one that matters. Skipping on a policy block skips everything, since
  // the next clip is blocked for exactly the same reason — which is how a
  // single bad header turns into a crate full of records marked dead.
  assert.equal(shouldSkipOnStall("unavailable"), true);
  assert.equal(shouldSkipOnStall("blocked"), false);
});

check("a blocked message gives the workaround, not a diagnosis", () => {
  const message = describeStall("Towerskull", false);
  assert.match(message, /Towerskull/);
  assert.match(message, /press play on the video/i);
  assert.ok(
    !/unavailable|skipping/i.test(message),
    "blamed the upload for something the browser did",
  );
});

check("describeStall still blames the upload when autoplay is allowed", () => {
  // The default keeps every existing call site honest.
  assert.match(describeStall("Towerskull"), /unavailable/i);
  assert.match(describeStall("Towerskull", true), /unavailable/i);
});

/* ---- did the press take? ---- */

check("a press that left the player where it was is blocked", () => {
  for (const state of [PLAYER_STATE.UNSTARTED, PLAYER_STATE.CUED]) {
    assert.equal(playOutcome(state), "blocked");
  }
});

check("anything else counts as started", () => {
  for (const state of [
    PLAYER_STATE.PLAYING,
    PLAYER_STATE.BUFFERING,
    PLAYER_STATE.ENDED,
  ]) {
    assert.equal(playOutcome(state), "started");
  }
});

check("PAUSED counts as started here, unlike in watchdogAction", () => {
  /*
   * The divergence is deliberate and worth pinning, because the two functions
   * answer different questions a second apart. `playOutcome` runs just after
   * a press, so PAUSED means the clip is loaded and someone paused it.
   */
  assert.equal(playOutcome(PLAYER_STATE.PAUSED), "started");
  assert.equal(watchdogAction(PLAYER_STATE.PAUSED), "clear");
});

check("an unknown future state is not called blocked", () => {
  // Inventing a refusal from a state we do not recognise would put a
  // workaround on screen for a clip that is playing perfectly well.
  assert.equal(playOutcome(42), "started");
});

check("the confirm window is much shorter than the stall window", () => {
  // Different questions: one is "did this press register", which is local and
  // immediate; the other is "will this ever load", which is a network.
  assert.ok(PLAY_CONFIRM_MS < START_TIMEOUT_MS / 4);
  assert.equal(PLAY_CONFIRM_MS, 1_200);
});

check("the blocked-play message names the one action that fixes it", () => {
  const message = describeBlockedPlay();
  assert.match(message, /press play on the video/i);
  assert.ok(
    !/error/i.test(message),
    "called it an error; nothing is wrong with the record",
  );
});

console.log(`\n${ran - failed}/${ran} watchdog tests passed.`);
if (failed > 0) process.exit(1);
