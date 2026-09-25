/**
 * Dig feed tests.
 *
 *   npm run test:dig-feed
 *
 * The dig drawer should never be a dead end: crate lanes reveal more until
 * they run out, and "dig deeper" appends the next page without moving what
 * is already on screen or showing a record twice.
 */
import assert from "node:assert/strict";
import {
  LOCAL_FIRST,
  LOCAL_STEP,
  MAX_DIG_PAGE,
  addedCount,
  appendLanes,
  finishedLanes,
  nextDigPage,
  revealMore,
  visibleCount,
} from "../src/client/digFeed.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const r = (id) => ({ releaseId: id });
const lane = (key, ids) => ({ lane: key, label: key, results: ids.map(r) });
const ids = (l) => l.results.map((x) => x.releaseId);

check("a crate lane starts with the first few", () => {
  assert.equal(visibleCount(undefined, 100), LOCAL_FIRST);
  assert.equal(visibleCount(undefined, 5), 5);
});

check("More reveals a step at a time and stops at the end", () => {
  assert.equal(revealMore(LOCAL_FIRST, 100), LOCAL_FIRST + LOCAL_STEP);
  assert.equal(revealMore(90, 100), 100);
  assert.equal(revealMore(100, 100), 100);
  assert.equal(revealMore(500, 100), 100, "never past the total");
  assert.equal(revealMore(-3, 100), LOCAL_STEP, "never negative");
});

check("appending keeps existing lanes and their order", () => {
  const out = appendLanes([lane("artist", [1, 2]), lane("label", [3])], [lane("artist", [4]), lane("label", [5, 6])]);
  assert.deepEqual(out.map((l) => l.lane), ["artist", "label"]);
  assert.deepEqual(ids(out[0]), [1, 2, 4]);
  assert.deepEqual(ids(out[1]), [3, 5, 6]);
});

check("a lane new on this page goes after the others", () => {
  const out = appendLanes([lane("artist", [1])], [lane("era", [7]), lane("artist", [2])]);
  assert.deepEqual(out.map((l) => l.lane), ["artist", "era"]);
  assert.deepEqual(ids(out[0]), [1, 2]);
});

check("nothing on screen is ever added twice, even across lanes", () => {
  const out = appendLanes([lane("artist", [1, 2])], [lane("label", [2, 3]), lane("artist", [3, 1, 4])]);
  const all = out.flatMap(ids);
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(ids(out[0]), [1, 2, 4]);
  assert.deepEqual(ids(out[1]), [3]);
});

check("appending never mutates what is on screen", () => {
  const current = [lane("artist", [1])];
  appendLanes(current, [lane("artist", [2])]);
  assert.deepEqual(ids(current[0]), [1]);
});

check("an empty page adds nothing and says so", () => {
  const before = [lane("artist", [1, 2])];
  const after = appendLanes(before, [lane("artist", [1, 2]), lane("label", [])]);
  assert.equal(addedCount(before, after), 0);
  assert.deepEqual(after.map((l) => l.lane), ["artist"], "no empty lanes appear");
  assert.equal(addedCount(before, appendLanes(before, [lane("era", [9])])), 1);
});

check("a lane a page added nothing to is finished; the others are not", () => {
  const before = [lane("versions", [1]), lane("style", [2, 3])];
  const after = appendLanes(before, [lane("versions", [1]), lane("style", [4, 5])]);
  assert.deepEqual(finishedLanes(before, after), ["versions"]);
  const brandNew = appendLanes(before, [lane("era", [9])]);
  assert.deepEqual(finishedLanes(before, brandNew).sort(), ["style", "versions"], "a lane only just appearing is not finished");
});

check("pages walk forward and stop at the cap", () => {
  assert.equal(nextDigPage(1), 2);
  assert.equal(nextDigPage(MAX_DIG_PAGE - 1), MAX_DIG_PAGE);
  assert.equal(nextDigPage(MAX_DIG_PAGE), null);
  assert.equal(nextDigPage(0), 2, "a bad page is treated as page one");
});

console.log(`${ran - failed}/${ran} dig feed tests passed`);
if (failed) process.exit(1);
