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
import { sortItems, nextSort, naturalDirection } from "../src/client/sorting.ts";

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
console.log(`All ${ran} sorting tests passed.`);
