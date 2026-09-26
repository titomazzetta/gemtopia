/**
 * Pull list tests.
 *
 *   npm run test:pull-list
 *
 * The list you take to the shelves: numbered in set order, one sleeve per
 * record, and ticks that never outlive the rows they belong to.
 */
import assert from "node:assert/strict";
import { prunePulled, pullRows, recordCount, togglePulled } from "../src/client/pullList.ts";

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

console.log(`${ran - failed}/${ran} pull list tests passed`);
if (failed) process.exit(1);
