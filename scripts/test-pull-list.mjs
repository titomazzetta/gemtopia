/**
 * Pull list tests.
 *
 *   npm run test:pull-list
 *
 * The list you take to the shelves: numbered in set order, one sleeve per
 * record, and ticks that never outlive the rows they belong to.
 */
import assert from "node:assert/strict";
import { prunePulled, pullRows, slotAt, slotInRows, slotToIndex, recordCount, togglePulled } from "../src/client/pullList.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const clip = (releaseId, video, over = {}) => ({
  key: `${releaseId}:${video}`, releaseId, videoId: video, silence: null, addedAt: null,
  title: `T${video}`, artist: "A", releaseTitle: `R${releaseId}`, year: null, genres: [], styles: [],
  labels: ["Peacefrog"], thumb: "", country: null, formats: [], duration: null, position: " A1 ",
  bpm: 124, matchKind: "track", ...over,
});
const set = [clip(1, "aaaaaaaaaaa"), clip(2, "bbbbbbbbbbb", { labels: [], position: null }), clip(1, "ccccccccccc")];

check("rows are numbered in set order", () => {
  assert.deepEqual(pullRows(set).map((r) => r.number), [1, 2, 3]);
});

check("a second track from the same record points at the first", () => {
  const rows = pullRows(set);
  assert.equal(rows[0].sameRecordAs, null);
  assert.equal(rows[1].sameRecordAs, null);
  assert.equal(rows[2].sameRecordAs, 1);
});

check("sleeves are counted by record, not track", () => {
  assert.equal(recordCount(set), 2);
  assert.equal(recordCount([]), 0);
});

check("position and label are tidy or absent", () => {
  const rows = pullRows(set);
  assert.equal(rows[0].position, "A1");
  assert.equal(rows[1].position, null);
  assert.equal(rows[0].label, "Peacefrog");
  assert.equal(rows[1].label, null);
});

check("ticking toggles without mutating", () => {
  const empty = new Set();
  const one = togglePulled(empty, "1:aaaaaaaaaaa");
  assert.equal(empty.size, 0);
  assert.ok(one.has("1:aaaaaaaaaaa"));
  assert.equal(togglePulled(one, "1:aaaaaaaaaaa").size, 0);
});

check("ticks for rows no longer in the set are dropped", () => {
  const kept = prunePulled(["1:aaaaaaaaaaa", "9:zzzzzzzzzzz"], set);
  assert.deepEqual([...kept], ["1:aaaaaaaaaaa"]);
});

check("dropping a row: slots map to final positions, remove-then-insert", () => {
  // Five rows; drag row 1.
  assert.equal(slotToIndex(1, 0), 0); // to the top
  assert.equal(slotToIndex(1, 1), 1); // the gap above itself: no move
  assert.equal(slotToIndex(1, 2), 1); // the gap below itself: no move
  assert.equal(slotToIndex(1, 3), 2); // past the next row
  assert.equal(slotToIndex(1, 5), 4); // to the bottom
});

check("the slot under the pointer comes from row middles", () => {
  const middles = [10, 30, 50];
  assert.equal(slotAt(0, middles), 0);
  assert.equal(slotAt(11, middles), 1);
  assert.equal(slotAt(30, middles), 1);
  assert.equal(slotAt(49, middles), 2);
  assert.equal(slotAt(999, middles), 3);
});

check("…and for rows all one height, from the offset into the list", () => {
  // Three rows of 20px: middles at 10, 30, 50 — the same answers as above.
  const middles = [10, 30, 50];
  assert.equal(slotInRows(0, 20, 3), 0);
  assert.equal(slotInRows(11, 20, 3), 1);
  assert.equal(slotInRows(29, 20, 3), 1);
  assert.equal(slotInRows(49, 20, 3), 2);
  assert.equal(slotInRows(999, 20, 3), 3); // past the end: the last gap, never further
  assert.equal(slotInRows(-50, 20, 3), 0); // above the top: the first
  // The row a drop lands in, through slotToIndex, agrees with the measured list.
  for (let y = 0; y < 70; y += 1) {
    assert.equal(slotInRows(y, 20, 3), slotAt(y, middles), `offset ${y}`);
  }
  assert.equal(slotInRows(30, 0, 3), 0); // no height yet: nothing to point at
  assert.equal(slotInRows(30, 20, 0), 0); // an empty list has one gap
  assert.equal(slotInRows(Number.NaN, 20, 3), 0);
});

console.log(`${ran - failed}/${ran} pull list tests passed`);
if (failed) process.exit(1);
