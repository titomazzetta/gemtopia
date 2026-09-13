/**
 * Recently-used playlist ordering.
 *
 *   npm run test:recent
 *
 * Small enough to look obviously right and exactly the kind of thing that is
 * not: the cases that bite are a playlist deleted on another device, an id
 * promoted twice, and the ordering being asked to preserve an order it was
 * never given.
 */
import assert from "node:assert/strict";
import { promote, orderByRecent } from "../src/client/recentPlaylists.ts";

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

const lists = (...ids) => ids.map((id) => ({ id, name: id.toUpperCase() }));

check("the first use puts a list at the front", () => {
  assert.deepEqual(promote([], "a"), ["a"]);
});

check("using a list again moves it to the front", () => {
  assert.deepEqual(promote(["a", "b", "c"], "c"), ["c", "a", "b"]);
});

check("re-using the front list changes nothing", () => {
  assert.deepEqual(promote(["a", "b"], "a"), ["a", "b"]);
});

check("an id is never duplicated", () => {
  const twice = promote(promote(["a", "b"], "b"), "b");
  assert.deepEqual(twice, ["b", "a"]);
});

check("promote does not mutate what it was given", () => {
  const original = ["a", "b"];
  promote(original, "b");
  assert.deepEqual(original, ["a", "b"], "the input array was rewritten");
});

check("promote returns a new array every time", () => {
  // It feeds React state; returning the same reference would mean the picker
  // does not re-order until some unrelated render happens to come along.
  const original = ["a"];
  assert.notEqual(promote(original, "a"), original);
});

check("with nothing recent, the given order is kept", () => {
  assert.deepEqual(
    orderByRecent(lists("a", "b", "c"), []).map((p) => p.id),
    ["a", "b", "c"],
  );
});

check("the last list used comes first", () => {
  assert.deepEqual(
    orderByRecent(lists("a", "b", "c"), ["c"]).map((p) => p.id),
    ["c", "a", "b"],
  );
});

check("several recent lists keep their own order", () => {
  assert.deepEqual(
    orderByRecent(lists("a", "b", "c", "d"), ["c", "a"]).map((p) => p.id),
    ["c", "a", "b", "d"],
  );
});

check("a playlist deleted elsewhere is skipped, not rendered as a hole", () => {
  assert.deepEqual(
    orderByRecent(lists("a", "b"), ["gone", "b"]).map((p) => p.id),
    ["b", "a"],
  );
});

check("no playlists is no rows, whatever is remembered", () => {
  assert.deepEqual(orderByRecent([], ["a", "b"]), []);
});

check("every playlist appears exactly once", () => {
  const ordered = orderByRecent(lists("a", "b", "c"), ["b", "b", "c"]);
  assert.deepEqual(ordered.map((p) => p.id).sort(), ["a", "b", "c"]);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} recent-playlist tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} recent-playlist tests passed.`);
