/**
 * Playback error tests.
 *
 *   npm run test:playback
 *
 * The bug these exist for: the onError handler took no argument, threw the
 * YouTube error code away, and skipped the track on every failure. That is
 * right for "the uploader disabled embedding" and wrong for "Safari's HTML5
 * player hiccuped" — and the second one walks the queue marking perfectly
 * good records unplayable, on one browser, while the user watches.
 */
import assert from "node:assert/strict";
import { describePlaybackError } from "../src/client/playbackErrors.ts";

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

/* ---- the distinction the whole module exists for ---- */

check("error 5 does not skip the track", () => {
  // The Safari case. The identical clip plays in Chrome, so the clip is fine
  // and the queue must not move on as though it were not.
  assert.equal(describePlaybackError(5).permanent, false);
});

check("embedding-disabled does skip", () => {
  for (const code of [101, 150]) {
    assert.equal(
      describePlaybackError(code).permanent,
      true,
      `error ${code} should skip — it will never play anywhere`,
    );
  }
});

check("removed and private videos skip", () => {
  assert.equal(describePlaybackError(100).permanent, true);
});

check("a bad video id skips", () => {
  assert.equal(describePlaybackError(2).permanent, true);
});

/* ---- the message has to be reportable ---- */

check("every known code names itself in the message", () => {
  for (const code of [2, 5, 100, 101, 150]) {
    const { message } = describePlaybackError(code);
    assert.match(
      message,
      /error \d+/,
      `error ${code} produced a message nobody could report back`,
    );
  }
});

check("error 5 tells you it is the browser, not the record", () => {
  const { message } = describePlaybackError(5);
  assert.match(message, /Chrome/);
  assert.ok(
    !/removed|private|uploader/i.test(message),
    "blamed the video for a browser-side failure",
  );
});

check("101 and 150 are described identically", () => {
  // YouTube documents them as the same condition; two wordings would be two
  // bug reports for one cause.
  assert.deepEqual(describePlaybackError(101), describePlaybackError(150));
});

/* ---- the unknown case ---- */

check("an unrecognised code is treated as transient, not permanent", () => {
  // Skipping is the destructive option: it drops a record out of the set you
  // are building. Guessing "permanent" for a code nobody has seen is how a
  // future YouTube change quietly eats a crate.
  for (const code of [7, 42, 999, undefined, null, "5", {}]) {
    assert.equal(
      describePlaybackError(code).permanent,
      false,
      `unknown code ${String(code)} was treated as permanent`,
    );
  }
});

check("a non-numeric code does not produce a mangled message", () => {
  for (const code of [undefined, null, "oops", {}]) {
    const { message } = describePlaybackError(code);
    assert.ok(!/undefined|null|\[object/.test(message), `leaked: ${message}`);
  }
});

check("every branch returns something showable", () => {
  for (const code of [2, 5, 100, 101, 150, 999, undefined]) {
    const { message, permanent } = describePlaybackError(code);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0);
    assert.equal(typeof permanent, "boolean");
  }
});

console.log(`\n${ran - failed}/${ran} playback error tests passed.`);
if (failed > 0) process.exit(1);
