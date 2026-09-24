/**
 * Playlist view tests.
 *
 *   npm run test:views
 *
 * A view is a lens over a set, never an edit to it. What these pin down:
 * "Your order" is the identity and always reachable; ties and unknowns keep
 * your order; a row on screen always maps back to the right stored entry (the
 * bug that would make Remove delete the wrong record); and adopting a view or
 * undoing one can reorder a set but never add, drop or duplicate a record.
 */
import assert from "node:assert/strict";
import {
  PLAYLIST_VIEWS,
  YOUR_ORDER,
  adoptView,
  canRestore,
  describeView,
  entryIndexAt,
  genreOf,
  isPermutation,
  nextView,
  viewPermutation,
} from "../src/client/playlistView.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

let n = 0;
const rec = (over = {}) => ({
  key: `k${n++}`, releaseId: 1, videoId: "abcdefghijk", silence: null, addedAt: null,
  title: "t", artist: "Someone", releaseTitle: "r", year: null, genres: [], styles: [],
  labels: [], thumb: "", country: null, formats: [], duration: null, position: null,
  bpm: null, matchKind: "release", ...over,
});
const at = (items, order) => order.map((i) => items[i]);

// A small set, in the order a DJ built it: not sorted by anything.
const set = [
  rec({ title: "Opener",  artist: "The Orb",     bpm: 118, year: 1991, styles: ["Ambient House"] }),
  rec({ title: "Lift",    artist: "Moodymann",   bpm: 122, year: 1997, styles: ["Deep House"] }),
  rec({ title: "Peak",    artist: "Jeff Mills",  bpm: 136, year: 1996, styles: ["Techno"] }),
  rec({ title: "Unknown", artist: "Moodymann",   bpm: null, year: null, styles: [] }),
  rec({ title: "Breathe", artist: "Basic Channel", bpm: 124, year: 1994, styles: ["Dub Techno"] }),
  rec({ title: "Close",   artist: "moodymann",   bpm: 122, year: 1997, styles: [], genres: ["Electronic"] }),
];

check("Your order is the identity, and is the default", () => {
  assert.deepEqual(viewPermutation(set, YOUR_ORDER), [0, 1, 2, 3, 4, 5]);
  assert.equal(PLAYLIST_VIEWS[0], "yours");
});

check("a view never mutates the stored rows", () => {
  const copy = [...set];
  viewPermutation(set, { view: "bpm", direction: "desc" });
  assert.deepEqual(set, copy);
});

check("every view of every set is a true permutation", () => {
  for (const view of PLAYLIST_VIEWS) for (const direction of ["asc", "desc"]) {
    const order = viewPermutation(set, { view, direction });
    assert.ok(isPermutation(order, set.length), `${view} ${direction}`);
  }
});

check("BPM ascending climbs, and the unmeasured record sinks", () => {
  const order = viewPermutation(set, { view: "bpm", direction: "asc" });
  assert.deepEqual(at(set, order).map((r) => r.bpm), [118, 122, 122, 124, 136, null]);
});

check("BPM descending: fastest first, the unmeasured record *still* last", () => {
  const order = viewPermutation(set, { view: "bpm", direction: "desc" });
  assert.deepEqual(at(set, order).map((r) => r.bpm), [136, 124, 122, 122, 118, null]);
});

check("ties keep your order, in both directions", () => {
  // "Lift" (index 1) and "Close" (index 5) are both 122 and both Moodymann.
  for (const direction of ["asc", "desc"]) {
    const titles = at(set, viewPermutation(set, { view: "bpm", direction })).map((r) => r.title);
    assert.ok(titles.indexOf("Lift") < titles.indexOf("Close"), direction);
  }
});

check("artist ignores case and a leading 'The', and groups an artist's records in your order", () => {
  const order = viewPermutation(set, { view: "artist", direction: "asc" });
  assert.deepEqual(at(set, order).map((r) => r.title),
    ["Breathe", "Peak", "Lift", "Unknown", "Close", "Opener"]);
});

check("genre reads the style, falling back to the broad genre", () => {
  assert.equal(genreOf(set[2]), "techno");
  assert.equal(genreOf(set[5]), "electronic");
  assert.equal(genreOf(set[3]), null);
  const order = viewPermutation(set, { view: "genre", direction: "asc" });
  assert.deepEqual(at(set, order).map((r) => r.title),
    ["Opener", "Lift", "Breathe", "Close", "Peak", "Unknown"]);
});

check("year: oldest first, undated last either way", () => {
  const up = at(set, viewPermutation(set, { view: "year", direction: "asc" })).map((r) => r.year);
  const down = at(set, viewPermutation(set, { view: "year", direction: "desc" })).map((r) => r.year);
  assert.deepEqual(up, [1991, 1994, 1996, 1997, 1997, null]);
  assert.deepEqual(down, [1997, 1997, 1996, 1994, 1991, null]);
});

check("tapping chips: switch, flip, and Your order always brings you home", () => {
  let state = YOUR_ORDER;
  state = nextView(state, "bpm");
  assert.deepEqual(state, { view: "bpm", direction: "asc" });
  state = nextView(state, "bpm");
  assert.deepEqual(state, { view: "bpm", direction: "desc" });
  state = nextView(state, "bpm");
  assert.deepEqual(state, { view: "bpm", direction: "asc" }, "no third tap that clears");
  state = nextView(state, "year");
  assert.deepEqual(state, { view: "year", direction: "asc" });
  assert.deepEqual(nextView(state, "yours"), YOUR_ORDER);
  assert.deepEqual(nextView(YOUR_ORDER, "yours"), YOUR_ORDER);
});

check("a row on screen maps to the entry behind it (Remove hits the right record)", () => {
  const order = viewPermutation(set, { view: "bpm", direction: "desc" });
  // The top row in fastest-first is "Peak", stored at index 2.
  assert.equal(entryIndexAt(order, 0), 2);
  assert.equal(set[entryIndexAt(order, 0)].title, "Peak");
  // Removing by the *visible* index would have deleted "Opener" instead.
  assert.notEqual(set[0].title, "Peak");
  assert.equal(entryIndexAt(order, 99), null);
});

check("the same clip twice stays two separate entries", () => {
  const twice = [set[1], set[2], set[1]];
  const order = viewPermutation(twice, { view: "bpm", direction: "asc" });
  assert.deepEqual(order, [0, 2, 1]);
  assert.ok(isPermutation(order, 3));
});

check("adopting a view reorders and nothing else", () => {
  const order = viewPermutation(set, { view: "bpm", direction: "asc" });
  const adopted = adoptView(set, order);
  assert.equal(adopted.length, set.length);
  assert.deepEqual([...adopted].map((r) => r.key).sort(), [...set].map((r) => r.key).sort());
  assert.deepEqual(adopted.map((r) => r.bpm), [118, 122, 122, 124, 136, null]);
});

check("adopting refuses anything that is not a true permutation", () => {
  assert.equal(adoptView(set, [0, 1, 2]), null, "short: would drop records");
  assert.equal(adoptView(set, [0, 0, 1, 2, 3, 4]), null, "duplicate: would clone one");
  assert.equal(adoptView(set, [0, 1, 2, 3, 4, 6]), null, "out of range: would invent one");
  assert.equal(adoptView(set, [0, 1, 2, 3, 4, 1.5]), null, "not an index");
  assert.equal(adoptView(set, [0, 1, 2, 3, 4, -1]), null);
});

check("undo only when it is a pure reorder of what is there now", () => {
  assert.equal(canRestore(["a", "b", "c"], ["c", "a", "b"]), true);
  assert.equal(canRestore(["a", "a", "b"], ["a", "b", "a"]), true);
  assert.equal(canRestore(["a", "b", "c"], ["a", "b"]), false, "removed since");
  assert.equal(canRestore(["a", "b"], ["a", "b", "c"]), false, "added since");
  assert.equal(canRestore(["a", "a", "b"], ["a", "b", "b"]), false, "same length, different records");
});

check("the status line names the view and says your order is kept", () => {
  assert.equal(describeView(YOUR_ORDER), "");
  assert.equal(describeView({ view: "bpm", direction: "asc" }), "By BPM, slowest first. Your order is saved.");
  assert.equal(describeView({ view: "year", direction: "desc" }), "By year, newest first. Your order is saved.");
  assert.equal(describeView({ view: "artist", direction: "asc" }), "By artist, A to Z. Your order is saved.");
});

console.log(`${ran - failed}/${ran} playlist view tests passed`);
if (failed) process.exit(1);
