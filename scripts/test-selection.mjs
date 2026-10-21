/**
 * Selection tests.
 *
 *   npm run test:selection
 *
 * Picking several tracks and acting on them at once. The parts that are easy
 * to get subtly wrong are pinned here: a shift-click range in either
 * direction, where a dragged block of rows lands (the same off-by-one family
 * as a single drag, multiplied), and what a bulk add or remove quietly skips.
 */
import assert from "node:assert/strict";
import {
  addedMessage,
  inOrder,
  isNoopBlockMove,
  moveBlock,
  planAdd,
  planRemove,
  presentOnly,
  removedMessage,
  selectAll,
  selectRange,
  taggedMessage,
  toggleKey,
} from "../src/client/selection.ts";
import { moveEntry } from "../src/client/playlistOrder.ts";
import { slotToIndex } from "../src/client/pullList.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const keys = ["a", "b", "c", "d", "e", "f"];
const sorted = (set) => [...set].sort();

/* ---------------- picking ---------------- */

check("a tick toggles, and never touches the set it was given", () => {
  const empty = new Set();
  const one = toggleKey(empty, "b");
  assert.deepEqual(sorted(one), ["b"]);
  assert.equal(empty.size, 0);
  assert.deepEqual(sorted(toggleKey(one, "b")), []);
});

check("shift-click ticks the run from the anchor, either way, adding to what's ticked", () => {
  assert.deepEqual(sorted(selectRange(new Set(["a"]), keys, "b", "e")), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(sorted(selectRange(new Set(), keys, "e", "b")), ["b", "c", "d", "e"]);
  assert.deepEqual(sorted(selectRange(new Set(), keys, "c", "c")), ["c"]);
});

check("with no anchor on screen, shift-click ticks just the one", () => {
  assert.deepEqual(sorted(selectRange(new Set(["a"]), keys, null, "d")), ["a", "d"]);
  assert.deepEqual(sorted(selectRange(new Set(), keys, "zzz", "d")), ["d"]);
  // A target that isn't in the list changes nothing.
  assert.deepEqual(sorted(selectRange(new Set(["a"]), keys, "a", "zzz")), ["a"]);
});

check("select all adds everything on screen to what's ticked", () => {
  assert.deepEqual(sorted(selectAll(new Set(["x"]), ["a", "b"])), ["a", "b", "x"]);
});

check("ticks for tracks that are gone are dropped", () => {
  assert.deepEqual(sorted(presentOnly(new Set(["a", "gone"]), keys)), ["a"]);
});

check("the ticked tracks come out in the order on screen, then the hidden ones", () => {
  const item = (key) => ({ key });
  const pool = ["a", "b", "c", "d"].map(item);
  const visible = ["d", "b"].map(item); // a filter, sorted differently
  const out = inOrder(new Set(["a", "b", "d"]), visible, pool).map((i) => i.key);
  assert.deepEqual(out, ["d", "b", "a"]);
});

/* ---------------- adding many ---------------- */

const entry = (item) => (item.ready === false ? null : { clipKey: item.key });

check("a bulk add skips what's already there, repeats and unsynced tracks, and says so", () => {
  const items = [{ key: "a" }, { key: "x" }, { key: "y", ready: false }, { key: "x" }, { key: "z" }];
  const plan = planAdd(["a", "b"], items, entry, 1000);
  assert.deepEqual(plan.entries.map((e) => e.clipKey), ["x", "z"]);
  assert.equal(plan.already, 2, "a was there, and the second x is a repeat");
  assert.equal(plan.notReady, 1);
  assert.equal(plan.overflow, 0);
});

check("a bulk add stops at the playlist's size limit and counts what didn't fit", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ key: `k${i}` }));
  const plan = planAdd(["e1", "e2", "e3"], items, entry, 8);
  assert.equal(plan.entries.length, 5);
  assert.equal(plan.overflow, 5);
  const full = planAdd(Array.from({ length: 8 }, (_, i) => `e${i}`), items, entry, 8);
  assert.equal(full.entries.length, 0);
  assert.equal(full.overflow, 10);
});

/* ---------------- removing many ---------------- */

check("a bulk remove takes out only what's yours to take, and keeps the order", () => {
  const rows = ["a", "b", "c", "d"].map((k, i) => ({ clipKey: k, mine: i % 2 === 0 }));
  const plan = planRemove(rows, new Set(["a", "b", "c"]), (row) => row.mine);
  assert.deepEqual(plan.keep.map((r) => r.clipKey), ["b", "d"]);
  assert.equal(plan.removed, 2);
  assert.equal(plan.refused, 1);
});

check("both rows of a doubled clip go when it's ticked", () => {
  const rows = ["a", "b", "a"].map((k) => ({ clipKey: k }));
  const plan = planRemove(rows, new Set(["a"]), () => true);
  assert.deepEqual(plan.keep.map((r) => r.clipKey), ["b"]);
  assert.equal(plan.removed, 2);
});

/* ---------------- moving a block ---------------- */

const L = () => ["a", "b", "c", "d", "e", "f"];

check("a block moves to the top, keeping its order", () => {
  assert.deepEqual(moveBlock(L(), [2, 4], 0), ["c", "e", "a", "b", "d", "f"]);
});

check("a block moves to the bottom", () => {
  assert.deepEqual(moveBlock(L(), [0, 2], 6), ["b", "d", "e", "f", "a", "c"]);
});

check("a block moves into the middle, from above and from below", () => {
  // Gap 4 is between d and e.
  assert.deepEqual(moveBlock(L(), [0, 1], 4), ["c", "d", "a", "b", "e", "f"]);
  // Gap 1 is between a and b.
  assert.deepEqual(moveBlock(L(), [4, 5], 1), ["a", "e", "f", "b", "c", "d"]);
});

check("a scattered block gathers where it's dropped", () => {
  // Rows b, d and f dropped between c and d (gap 3), which is inside the block's span.
  assert.deepEqual(moveBlock(L(), [1, 3, 5], 3), ["a", "c", "b", "d", "f", "e"]);
});

check("one row moved as a block is exactly a single move, for every row and gap", () => {
  for (let from = 0; from < 6; from += 1) {
    for (let slot = 0; slot <= 6; slot += 1) {
      assert.deepEqual(
        moveBlock(L(), [from], slot),
        moveEntry(L(), from, slotToIndex(from, slot)),
        `row ${from} to gap ${slot}`,
      );
    }
  }
});

check("every block move keeps every row exactly once", () => {
  const blocks = [[0], [1, 2], [0, 5], [1, 3, 4], [0, 1, 2, 3, 4, 5]];
  for (const block of blocks) {
    for (let slot = 0; slot <= 6; slot += 1) {
      const out = moveBlock(L(), block, slot);
      assert.deepEqual([...out].sort(), L(), `${block} to ${slot}`);
    }
  }
});

check("bad indices are ignored, and an empty block moves nothing", () => {
  assert.deepEqual(moveBlock(L(), [-1, 99, 1.5], 0), L());
  assert.deepEqual(moveBlock(L(), [], 3), L());
  assert.deepEqual(moveBlock(L(), [2, 2, 2], 0), ["c", "a", "b", "d", "e", "f"]);
});

check("a drop that changes nothing is known in advance, so no line is drawn for it", () => {
  // A contiguous block dropped on its own gaps, or inside itself.
  for (const slot of [1, 2, 3]) assert.ok(isNoopBlockMove(6, [1, 2], slot), `gap ${slot}`);
  assert.ok(!isNoopBlockMove(6, [1, 2], 0));
  assert.ok(!isNoopBlockMove(6, [1, 2], 4));
  // A scattered block isn't a no-op where it would gather.
  assert.ok(!isNoopBlockMove(6, [1, 3], 2));
  assert.ok(isNoopBlockMove(6, [], 2));
});

/* ---------------- what the toast says ---------------- */

check("a bulk add says what went in, and what didn't and why", () => {
  const plan = (n, already = 0, notReady = 0, overflow = 0) => ({ entries: Array(n).fill({}), already, notReady, overflow });
  assert.equal(addedMessage("B2B", plan(12), 1000), "Added 12 tracks to B2B");
  assert.equal(addedMessage("B2B", plan(1), 1000), "Added 1 track to B2B");
  assert.equal(addedMessage("B2B", plan(9, 2, 1), 1000), "Added 9 tracks to B2B · 2 already in it · 1 not synced yet");
  assert.equal(addedMessage("B2B", plan(5, 0, 0, 88), 1000), "Added 5 tracks to B2B · 88 didn't fit — a set holds 1,000");
  assert.equal(addedMessage("B2B", plan(0, 0, 0, 3), 1000), "B2B is full — a set holds 1,000");
  assert.equal(addedMessage("B2B", plan(0, 4), 1000), "All 4 are already in B2B");
  assert.equal(addedMessage("B2B", plan(0, 1), 1000), "Already in B2B");
  assert.equal(addedMessage("B2B", plan(0, 0, 2), 1000), "Those haven't synced from Discogs yet, so they can't go in a playlist");
  assert.equal(addedMessage("B2B", plan(0, 1, 2), 1000), "Nothing new for B2B · 1 already in it · 2 not synced yet");
});

check("a bulk remove says why anything ticked is still there", () => {
  assert.equal(removedMessage("B2B", { removed: 3, refused: 0 }), "Took 3 tracks out of B2B");
  assert.equal(
    removedMessage("B2B", { removed: 1, refused: 2 }),
    "Took 1 track out of B2B · 2 added by others stay — you can take out only what you added",
  );
  assert.equal(removedMessage("B2B", { removed: 0, refused: 1 }), "That one was added by someone else — you can take out only what you added");
  assert.equal(removedMessage("B2B", { removed: 0, refused: 4 }), "Those were added by others — you can take out only what you added");
});

check("tagging a selection says what happened", () => {
  assert.equal(taggedMessage({ tag: "opening", tagged: 12, already: 0, full: 0 }, 0, 12), "Tagged 12 tracks #opening");
  assert.equal(
    taggedMessage({ tag: "opening", tagged: 9, already: 2, full: 1 }, 3, 12),
    "Tagged 9 tracks #opening · 2 already had it · 1 at 12 tags already · 3 not synced yet",
  );
  assert.equal(taggedMessage({ tag: "deep", tagged: 0, already: 5, full: 0 }, 0, 12), "All 5 already have #deep");
  assert.equal(taggedMessage({ tag: "deep", tagged: 0, already: 0, full: 2 }, 0, 12), "Nothing to tag #deep · 2 at 12 tags already");
});

console.log(`${ran - failed}/${ran} selection tests passed`);
if (failed) process.exit(1);
