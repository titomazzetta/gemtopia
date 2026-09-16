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
import { needsSync, FRESH_FOR_MS } from "../src/client/crateFreshness.ts";

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

console.log(`\n${ran - failed}/${ran} freshness tests passed.`);
if (failed > 0) process.exit(1);
