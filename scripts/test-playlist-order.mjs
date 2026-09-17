/**
 * Playlist reorder tests.
 *
 *   npm run test:order
 *
 * Drag-to-reorder is four lines that look obviously right and are a classic
 * off-by-one: removing at `from` shifts everything after it down, so the
 * insert index means different things going up versus down. This repo has
 * already had one index bug of exactly that shape, in the play queue, found
 * by reading rather than by a test.
 */
import assert from "node:assert/strict";
import { moveEntry } from "../src/client/playlistOrder.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const L = () => ["a", "b", "c", "d", "e"];

check("dragging down lands on the row you dropped onto", () => {
  assert.deepEqual(moveEntry(L(), 0, 3), ["b", "c", "d", "a", "e"]);
  assert.equal(moveEntry(L(), 0, 3)[3], "a");
});

check("dragging up lands on the row you dropped onto", () => {
  assert.deepEqual(moveEntry(L(), 3, 0), ["d", "a", "b", "c", "e"]);
  assert.equal(moveEntry(L(), 3, 0)[0], "d");
});

check("a one-step move in either direction is a swap", () => {
  assert.deepEqual(moveEntry(L(), 1, 2), ["a", "c", "b", "d", "e"]);
  assert.deepEqual(moveEntry(L(), 2, 1), ["a", "c", "b", "d", "e"]);
});

check("moving to the last position works from anywhere", () => {
  assert.deepEqual(moveEntry(L(), 0, 4), ["b", "c", "d", "e", "a"]);
  assert.deepEqual(moveEntry(L(), 3, 4), ["a", "b", "c", "e", "d"]);
});

check("every move preserves length and contents", () => {
  const original = L();
  for (let from = 0; from < 5; from += 1) {
    for (let to = 0; to < 5; to += 1) {
      const out = moveEntry(original, from, to);
      assert.equal(out.length, 5, `${from}->${to} changed the length`);
      assert.deepEqual([...out].sort(), [...original].sort(), `${from}->${to} lost or duplicated a row`);
    }
  }
});

check("a move and its reverse round-trip", () => {
  for (let from = 0; from < 5; from += 1) {
    for (let to = 0; to < 5; to += 1) {
      assert.deepEqual(moveEntry(moveEntry(L(), from, to), to, from), L(), `${from}->${to} did not reverse`);
    }
  }
});

check("the input is never mutated", () => {
  const original = L();
  moveEntry(original, 0, 4);
  assert.deepEqual(original, L(), "mutated the array React is rendering from");
});

check("a no-op returns a copy, not the same reference", () => {
  // Returning the original would let a caller mutate React state in place.
  const original = L();
  assert.notEqual(moveEntry(original, 2, 2), original);
  assert.deepEqual(moveEntry(original, 2, 2), original);
});

check("out-of-range indices are refused without dropping a row", () => {
  for (const [from, to] of [[-1, 2], [2, -1], [9, 0], [0, 9], [1.5, 2], [2, NaN]]) {
    assert.deepEqual(moveEntry(L(), from, to), L(), `${from}->${to} disturbed the list`);
  }
});

check("a one-item list cannot be reordered into nothing", () => {
  assert.deepEqual(moveEntry(["only"], 0, 0), ["only"]);
});

console.log(`\n${ran - failed}/${ran} playlist order tests passed.`);
if (failed > 0) process.exit(1);
