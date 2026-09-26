/**
 * Sync queue tests.
 *
 *   npm run test:sync-queue
 *
 * The first sync can't go faster than Discogs allows, so it has to fetch the
 * right records first: what you tapped, then what you're searching for, then
 * everything else in order. And it must never skip or duplicate a record.
 */
import assert from "node:assert/strict";
import { MAX_PRIORITY, mergePriority, nextBatch } from "../src/client/syncQueue.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

check("with no priority, batches follow the pending order", () => {
  assert.deepEqual(nextBatch([1, 2, 3, 4, 5], [], 2), { batch: [1, 2], rest: [3, 4, 5] });
});

check("a tapped record is in the very next batch", () => {
  const { batch, rest } = nextBatch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [9], 8);
  assert.equal(batch[0], 9);
  assert.equal(batch.length, 8);
  assert.ok(!rest.includes(9));
});

check("priority ids already fetched (not pending) are ignored", () => {
  assert.deepEqual(nextBatch([3, 4], [1, 2, 4], 8), { batch: [4, 3], rest: [] });
});

check("draining the queue fetches every record exactly once", () => {
  let pending = Array.from({ length: 37 }, (_, i) => i + 1);
  let priority = [30, 12, 99, 30];
  const seen = [];
  while (pending.length) {
    const { batch, rest } = nextBatch(pending, priority, 8);
    seen.push(...batch);
    pending = rest;
    if (seen.length === 8) priority = mergePriority(priority, [37, 36]);
  }
  assert.equal(seen.length, 37);
  assert.equal(new Set(seen).size, 37);
  assert.deepEqual(seen.slice(0, 2), [30, 12]);
  assert.deepEqual(seen.slice(8, 10), [37, 36], "a request mid-sync goes into the next batch");
});

check("a bad batch size still makes progress", () => {
  assert.deepEqual(nextBatch([1, 2], [], 0).batch, [1]);
});

check("the newest request goes first, without duplicates", () => {
  assert.deepEqual(mergePriority([5, 6], [7, 5]), [7, 5, 6]);
});

check("priority ignores junk and is capped", () => {
  assert.deepEqual(mergePriority([], [0, -1, 1.5, 4]), [4]);
  const many = Array.from({ length: MAX_PRIORITY + 50 }, (_, i) => i + 1);
  assert.equal(mergePriority([], many).length, MAX_PRIORITY);
});

console.log(`${ran - failed}/${ran} sync queue tests passed`);
if (failed) process.exit(1);
