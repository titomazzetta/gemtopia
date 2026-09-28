/**
 * Search play tests.
 *
 *   npm run test:search-play
 *
 * Tapping a search result should play the record in running order, and a
 * search for a track name should start on that track.
 */
import assert from "node:assert/strict";
import { searchRecord, startIndexFor } from "../src/client/searchPlay.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

let seq = 0;
const video = (title) => ({ id: `v${String(seq++).padStart(10, "0")}`, title, duration: 300 });
const track = (position, title) => ({ position, title, duration: "5:00", artists: [] });
const detail = (over = {}) => ({
  id: 77, title: "Moneyshot EP", artist: "Rob & Si", year: 2004, genres: ["Electronic"],
  styles: ["Tech House"], labels: ["Drugsex"], formats: ["Vinyl"], country: "US", artistIds: [1],
  labelIds: [2], thumb: "", coverImage: "", addedAt: null, notes: null,
  market: { forSale: 1, lowestPrice: 10, have: 1, want: 1 },
  tracks: [track("A", "Money Shot"), track("B1", "Surface Static (Fuzz Mix)"), track("B2", "Surface Static (Iteration X Mix)")],
  videos: [video("Rob & Si - Surface Static (Fuzz Mix)"), video("Rob & Si - Money Shot")],
  fetchedAt: 0, ...over,
});

check("a record plays in running order, not the order videos arrived in", () => {
  const record = searchRecord(detail());
  assert.ok(record);
  assert.deepEqual(record.queue.map((p) => p.position), ["A", "B1"]);
  assert.equal(record.order.rows.length, 3, "the track with no preview is still listed");
});

check("nothing to play is null, not an empty queue", () => {
  assert.equal(searchRecord(detail({ videos: [] })), null);
});

check("a track-name search starts on that track", () => {
  const { queue } = searchRecord(detail());
  assert.equal(startIndexFor(queue, "surface static fuzz"), 1);
  assert.equal(startIndexFor(queue, "Money Shot"), 0);
});

check("an artist or record search starts at the top", () => {
  const { queue } = searchRecord(detail());
  assert.equal(startIndexFor(queue, "Rob & Si"), 0);
  assert.equal(startIndexFor(queue, ""), 0);
  assert.equal(startIndexFor(queue, "x"), 0);
});

console.log(`${ran - failed}/${ran} search play tests passed`);
if (failed) process.exit(1);
