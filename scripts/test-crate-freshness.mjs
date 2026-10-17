/**
 * Sync freshness tests.
 *
 *   npm run test:freshness
 *
 * This rule has already been wrong once, in a way nothing could catch: it
 * read `!state || state.status !== "done"`, so once a sync finished the app
 * never looked again. You could buy a record on Tuesday and it stayed
 * invisible until you found the resync button. It lived inside a component's
 * boot effect, where no test could reach it.
 */
import assert from "node:assert/strict";
import { needsListing, needsSync, FRESH_FOR_MS } from "../src/client/crateFreshness.ts";
import { applyWantEdits, retireWantEdits } from "../src/client/wantEdits.ts";

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

const NOW = 1_757_000_000_000;
const done = (updatedAt) => ({ status: "done", updatedAt });

check("a device that has never synced needs one", () => {
  assert.equal(needsSync(null, NOW), true);
});

check("an unfinished sync is resumed, whatever its age", () => {
  for (const status of ["listing", "detailing", "paused", "error"]) {
    assert.equal(
      needsSync({ status, updatedAt: NOW }, NOW),
      true,
      `status ${status} should not be trusted as complete`,
    );
  }
});

check("a sync finished seconds ago is trusted", () => {
  assert.equal(needsSync(done(NOW - 5_000), NOW), false);
});

check("a sync finished an hour ago is re-checked", () => {
  // The regression this file exists for. A completed sync must NOT mean
  // "never look again" — the whole point is that records keep arriving.
  assert.equal(needsSync(done(NOW - 60 * 60 * 1000), NOW), true);
});

check("the window boundary is exclusive on both sides", () => {
  assert.equal(needsSync(done(NOW - FRESH_FOR_MS), NOW), false, "exactly at the window is still fresh");
  assert.equal(needsSync(done(NOW - FRESH_FOR_MS - 1), NOW), true, "one ms past is stale");
});

check("a burst of reloads inside the window costs no requests", () => {
  const finished = done(NOW);
  for (const offset of [0, 1_000, 60_000, 14 * 60 * 1000]) {
    assert.equal(
      needsSync(finished, NOW + offset),
      false,
      `a reload ${offset}ms later re-listed the whole collection`,
    );
  }
});

check("a future timestamp counts as stale, not impossibly fresh", () => {
  // A clock that moved backwards would otherwise pin the crate until real
  // time caught up — minutes or hours of an app that refuses to look.
  assert.equal(needsSync(done(NOW + 60 * 60 * 1000), NOW), true);
});

check("the window is fifteen minutes", () => {
  // Pinned because it is a judgement, not an implementation detail: long
  // enough that tab reloads are free, short enough that this morning's
  // record shows up before tonight.
  assert.equal(FRESH_FOR_MS, 15 * 60 * 1000);
});

/* ---- the wantlist's listing, kept current in the background ---- */

check("a wantlist never listed on this device is listed", () => {
  assert.equal(needsListing(null, null, NOW), true);
});

check("a listing from a minute ago is left alone", () => {
  assert.equal(needsListing(NOW - 60_000, null, NOW), false);
});

check("a listing older than the window is read again", () => {
  assert.equal(needsListing(NOW - FRESH_FOR_MS - 1, null, NOW), true);
});

check("a fresh full sync of the wantlist already read its listing", () => {
  assert.equal(needsListing(null, done(NOW - 60_000), NOW), false);
});

check("a stale or unfinished full sync doesn't stand in for a listing", () => {
  assert.equal(needsListing(null, done(NOW - FRESH_FOR_MS - 1), NOW), true);
  assert.equal(needsListing(null, { status: "detailing", updatedAt: NOW }, NOW), true);
  assert.equal(needsListing(NOW - 60_000, { status: "error", updatedAt: NOW }, NOW), false, "but a fresh listing still counts");
});

check("a listing time in the future means the clock moved: look again", () => {
  assert.equal(needsListing(NOW + 60_000, null, NOW), true);
});

/*
 * The hearts pressed between listings. IndexedDB holds the wantlist as the
 * last listing read it; a re-read of it used to drop a heart pressed since,
 * and the heart flipped back though Discogs had the change.
 */
check("a heart pressed since the last listing survives a re-read", () => {
  const stored = new Set([1, 2, 3]);
  const edits = new Map([
    [4, { wanted: true, at: NOW }],
    [2, { wanted: false, at: NOW }],
  ]);
  assert.deepEqual([...applyWantEdits(stored, edits)].sort(), [1, 3, 4]);
  assert.deepEqual([...stored].sort(), [1, 2, 3], "what was read stays as read");
});

check("the latest press of a heart is the one that counts", () => {
  const edits = new Map();
  edits.set(7, { wanted: true, at: NOW });
  edits.set(7, { wanted: false, at: NOW + 1_000 });
  assert.equal(applyWantEdits(new Set([7]), edits).has(7), false);
});

check("a listing that began after a press has read it back: it's retired", () => {
  const edits = new Map([
    [4, { wanted: true, at: NOW - 5_000 }],
    [5, { wanted: false, at: NOW - 1 }],
  ]);
  retireWantEdits(edits, NOW);
  assert.equal(edits.size, 0);
});

check("a press made while the listing paged stays for the next one", () => {
  // Its page may already have been read; the listing can't vouch for it.
  const edits = new Map([
    [4, { wanted: true, at: NOW - 5_000 }],
    [9, { wanted: true, at: NOW + 3_000 }],
    [8, { wanted: false, at: NOW }],
  ]);
  retireWantEdits(edits, NOW);
  assert.deepEqual([...edits.keys()].sort(), [8, 9]);
});

console.log(`\n${ran - failed}/${ran} freshness tests passed.`);
if (failed > 0) process.exit(1);
