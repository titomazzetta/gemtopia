/**
 * Crate sorting tests.
 *
 *   npm run test:sorting
 *
 * The interesting cases are all about *missing* values. A crate part-way
 * through being measured is mostly records with no BPM, and a sort that
 * scatters them, or flips them to the top when reversed, is unusable. These
 * pin that unknowns sink in both directions, and that the order is total so a
 * re-render cannot make the list twitch.
 */
import assert from "node:assert/strict";
import {
  sortItems,
  nextSort,
  naturalDirection,
  DEFAULT_SORT,
} from "../src/client/sorting.ts";

let ran = 0;
let failed = 0;

function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

let seq = 0;
const item = (over = {}) => ({
  key: `k${seq++}`,
  releaseId: 1,
  videoId: "aaaaaaaaaaa",
  title: "Title",
  artist: "Artist",
  releaseTitle: "Release",
  year: 1994,
  genres: [],
  styles: [],
  labels: ["Label"],
  thumb: "",
  country: "US",
  formats: [],
  duration: 300,
  position: "A1",
  bpm: 124,
  matchKind: "track",
  ...over,
});

const titles = (list) => list.map((i) => i.title);
const bpms = (list) => list.map((i) => i.bpm);

/* -- unknowns sink, in both directions ----------------------------------- */

check("ascending by bpm puts unmeasured tracks last", () => {
  const sorted = sortItems(
    [item({ title: "c", bpm: null }), item({ title: "a", bpm: 130 }), item({ title: "b", bpm: 118 })],
    { key: "bpm", direction: "asc" },
  );
  assert.deepEqual(bpms(sorted), [118, 130, null]);
});

check("descending by bpm ALSO puts unmeasured tracks last", () => {
  // The whole point. A symmetric reversal would float every unmeasured record
  // to the top the moment you flip direction, which is what makes a
  // part-measured crate feel broken.
  const sorted = sortItems(
    [item({ title: "c", bpm: null }), item({ title: "a", bpm: 130 }), item({ title: "b", bpm: 118 })],
    { key: "bpm", direction: "desc" },
  );
  assert.deepEqual(bpms(sorted), [130, 118, null]);
});

check("a list of all-unknown values does not throw or reorder wildly", () => {
  const sorted = sortItems(
    [item({ title: "b", bpm: null }), item({ title: "a", bpm: null })],
    { key: "bpm", direction: "asc" },
  );
  assert.deepEqual(titles(sorted), ["a", "b"]);
});

check("missing years sink too", () => {
  const sorted = sortItems(
    [item({ title: "b", year: null }), item({ title: "a", year: 1988 })],
    { key: "year", direction: "desc" },
  );
  assert.deepEqual(titles(sorted), ["a", "b"]);
});

check("an empty label string counts as missing, not as an empty sort key", () => {
  const sorted = sortItems(
    [item({ title: "b", labels: [] }), item({ title: "a", labels: ["Peacefrog"] })],
    { key: "label", direction: "asc" },
  );
  assert.deepEqual(titles(sorted), ["a", "b"]);
});

/* -- ordering ------------------------------------------------------------ */

check("text sorts case-insensitively", () => {
  const sorted = sortItems(
    [item({ title: "banana" }), item({ title: "Apple" }), item({ title: "cherry" })],
    { key: "title", direction: "asc" },
  );
  assert.deepEqual(titles(sorted), ["Apple", "banana", "cherry"]);
});

check("a leading article is ignored — The Orb files under O", () => {
  const sorted = sortItems(
    [item({ title: "z", artist: "The Orb" }), item({ title: "a", artist: "Nightmares On Wax" })],
    { key: "artist", direction: "asc" },
  );
  // Nightmares (N) before Orb (O). Sorting on "The" would invert this.
  assert.deepEqual(titles(sorted), ["a", "z"]);
});

check("numbers inside text sort numerically, not lexically", () => {
  const sorted = sortItems(
    [item({ title: "Track 10" }), item({ title: "Track 2" })],
    { key: "title", direction: "asc" },
  );
  assert.deepEqual(titles(sorted), ["Track 2", "Track 10"]);
});

check("decimal tempos order correctly", () => {
  const sorted = sortItems(
    [item({ bpm: 124.7 }), item({ bpm: 124.1 }), item({ bpm: 124.4 })],
    { key: "bpm", direction: "asc" },
  );
  assert.deepEqual(bpms(sorted), [124.1, 124.4, 124.7]);
});

/* -- determinism --------------------------------------------------------- */

check("the sort is total — equal keys never swap between runs", () => {
  const input = [
    item({ title: "b", bpm: 124 }),
    item({ title: "a", bpm: 124 }),
    item({ title: "c", bpm: 124 }),
  ];
  const once = titles(sortItems(input, { key: "bpm", direction: "asc" }));
  const twice = titles(sortItems(input, { key: "bpm", direction: "asc" }));
  assert.deepEqual(once, twice);
  assert.deepEqual(once, ["a", "b", "c"], "ties should break on title");
});

check("sorting does not mutate the input", () => {
  const input = [item({ title: "b" }), item({ title: "a" })];
  const before = titles(input);
  sortItems(input, { key: "title", direction: "asc" });
  assert.deepEqual(titles(input), before, "the caller's array was reordered");
});

check("an empty list sorts to an empty list", () => {
  assert.deepEqual(sortItems([], { key: "bpm", direction: "asc" }), []);
});

/* -- the header click cycle ---------------------------------------------- */

check("first click sorts in the column's natural direction", () => {
  assert.deepEqual(nextSort(null, "bpm"), { key: "bpm", direction: "asc" });
  assert.deepEqual(nextSort(null, "title"), { key: "title", direction: "asc" });
});

check("second click on the same column reverses it", () => {
  const first = nextSort(null, "bpm");
  assert.deepEqual(nextSort(first, "bpm"), { key: "bpm", direction: "desc" });
});

check("third click clears the sort, returning to shuffle order", () => {
  // This state matters more here than in most tables: the unsorted order of a
  // crate is a shuffle, and there has to be a way back to it.
  const first = nextSort(null, "bpm");
  const second = nextSort(first, "bpm");
  assert.equal(nextSort(second, "bpm"), null);
});

check("clicking a different column starts that column fresh", () => {
  const descending = { key: "bpm", direction: "desc" };
  assert.deepEqual(nextSort(descending, "year"), {
    key: "year",
    direction: naturalDirection("year"),
  });
});

check("every sort key has a natural direction", () => {
  for (const key of ["title", "artist", "label", "year", "bpm", "duration"]) {
    assert.ok(["asc", "desc"].includes(naturalDirection(key)), `${key} has none`);
  }
});

/* ------------------------------------------------------------------------ */

if (failed > 0) {
  console.error(`\n${failed} of ${ran} sorting tests failed.`);
  process.exit(1);
}
/* ---- added date ------------------------------------------------------- */

check("recently added reads newest first, unlike every other column", () => {
  assert.equal(naturalDirection("added"), "desc");
});

check("added sorts chronologically, not lexically", () => {
  // The trap: string comparison happens to work for UTC ISO-8601 and stops
  // working the moment Discogs returns an offset. "+01:00" sorts before "Z"
  // lexically and after it chronologically, so a record bought at 23:30 in
  // London would file a day late.
  const items = [
    item({ key: "a", addedAt: "2026-01-02T00:30:00+01:00" }),
    item({ key: "b", addedAt: "2026-01-01T23:00:00Z" }),
  ];
  const sorted = sortItems(items, { key: "added", direction: "asc" });
  assert.deepEqual(
    sorted.map((i) => i.key),
    ["b", "a"],
    "sorted ISO strings lexically instead of comparing instants",
  );
});

check("a record with no added date sinks, in both directions", () => {
  const items = [
    item({ key: "unknown", addedAt: null }),
    item({ key: "known", addedAt: "2026-01-01T00:00:00Z" }),
  ];
  for (const direction of ["asc", "desc"]) {
    const sorted = sortItems(items, { key: "added", direction });
    assert.equal(
      sorted[sorted.length - 1].key,
      "unknown",
      `unknown floated to the top in ${direction}`,
    );
  }
});

check("a malformed date is treated as unknown, not as zero", () => {
  // Date.parse returns NaN, and NaN must sink like null rather than sorting
  // as the beginning of time and claiming to be your oldest record.
  const items = [
    item({ key: "bad", addedAt: "not a date" }),
    item({ key: "good", addedAt: "2026-01-01T00:00:00Z" }),
  ];
  const sorted = sortItems(items, { key: "added", direction: "asc" });
  assert.equal(sorted[0].key, "good");
  assert.equal(sorted[1].key, "bad");
});

check("the crate reads newest first before anybody sorts it", () => {
  assert.deepEqual(DEFAULT_SORT, { key: "added", direction: "desc" });
});

check("the default puts this week's record above one bought years ago", () => {
  const items = [
    item({ key: "old", addedAt: "2019-04-01T00:00:00Z" }),
    item({ key: "new", addedAt: "2026-09-10T00:00:00Z" }),
  ];
  assert.deepEqual(
    sortItems(items, DEFAULT_SORT).map((i) => i.key),
    ["new", "old"],
  );
});

check("clearing a sort lands on the default, not on an arbitrary order", () => {
  // Third click returns null, and null means DEFAULT_SORT to the caller. What
  // it used to mean was IndexedDB key order, which is by release id and is
  // not an order anybody chose.
  const cleared = nextSort({ key: "year", direction: "desc" }, "year");
  assert.equal(cleared, null);
});

console.log(`All ${ran} sorting tests passed.`);
