/**
 * Exploring a record, and getting back to the shuffle.
 *
 *   npm run test:record
 *
 * Built around one real moment: a track from an EP comes up on shuffle, you
 * want the rest of the EP in order, then you want your shuffle back where you
 * left it. Every test here is a way that moment can go wrong.
 */
import assert from "node:assert/strict";
import { comparePositions, recordQueue, runningOrder } from "../src/client/recordOrder.ts";
import { beginDetour, detourEnds, resumePoint } from "../src/client/detour.ts";

let ran = 0;
let failed = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

const RELEASE = 4242;

function clip(videoId, { position = null, title = videoId, matchKind = "track", releaseId = RELEASE } = {}) {
  return {
    key: `${releaseId}:${videoId}`,
    releaseId,
    videoId,
    title,
    artist: "Din",
    releaseTitle: "Melon Ball EP",
    year: 2019,
    genres: ["Electronic"],
    styles: ["Deep House"],
    labels: ["Clone Basement Series"],
    thumb: "",
    country: "Netherlands",
    formats: ["Vinyl"],
    duration: null,
    position,
    bpm: null,
    matchKind,
    silence: null,
    addedAt: null,
  };
}

function detail(tracks) {
  return { id: RELEASE, tracks, videos: [], notes: null, market: null, fetchedAt: 0 };
}

const t = (position, title, duration = null) => ({ position, title, duration, artists: [] });

// A four-track EP. B1 has no clip on Discogs.
const TRACKS = [t("A1", "Melon Ball", "6:12"), t("A2", "Rind"), t("B1", "Seed"), t("B2", "Pip", "5:40")];
const A1 = clip("vA1", { position: "A1", title: "Melon Ball" });
const A2 = clip("vA2", { position: "A2", title: "Rind" });
const B2 = clip("vB2", { position: "B2", title: "Pip" });
const RIP = clip("vFULL", { title: "Melon Ball EP (full)", matchKind: "release" });
const ELSEWHERE = clip("vX", { position: "A1", releaseId: 999 });

/* ---- the running order ---- */

console.log("\nthe whole record, in order");

check("rows follow the tracklist, not the order clips arrived in", () => {
  const order = runningOrder(A2, detail(TRACKS), [B2, ELSEWHERE, A2, A1]);
  assert.deepEqual(order.rows.map((r) => r.position), ["A1", "A2", "B1", "B2"]);
});

check("the playing track is in the list, and marked", () => {
  // The old "Rest of" lane filtered it out, so you could not see where you
  // were on the record.
  const order = runningOrder(A2, detail(TRACKS), [A1, A2, B2]);
  assert.deepEqual(order.rows.map((r) => r.current), [false, true, false, false]);
});

check("a track with no clip still appears, so you see what the record holds", () => {
  const order = runningOrder(A1, detail(TRACKS), [A1, A2, B2]);
  const b1 = order.rows.find((r) => r.position === "B1");
  assert.equal(b1.title, "Seed");
  assert.equal(b1.playable, null);
});

check("durations come through from the tracklist", () => {
  const order = runningOrder(A1, detail(TRACKS), [A1]);
  assert.equal(order.rows[0].duration, "6:12");
});

check("clips from other releases never leak in", () => {
  // ELSEWHERE is also position A1 — the classic way a matcher cross-wires.
  const order = runningOrder(A1, detail(TRACKS), [A1, ELSEWHERE]);
  assert.equal(order.rows[0].playable.key, A1.key);
  assert.ok(!order.extras.some((c) => c.key === ELSEWHERE.key));
});

check("a full-record rip is set aside, not played as a track", () => {
  // Wedged into the running order it would play the whole EP a second time.
  const order = runningOrder(A1, detail(TRACKS), [A1, A2, B2, RIP]);
  assert.deepEqual(order.extras.map((c) => c.key), [RIP.key]);
  assert.ok(!recordQueue(order).some((c) => c.key === RIP.key));
});

check("title matching fills in where the matcher recorded no position", () => {
  const unpositioned = clip("vB2b", { title: "pip" });
  const order = runningOrder(A1, detail(TRACKS), [A1, unpositioned]);
  assert.equal(order.rows.find((r) => r.position === "B2").playable.key, unpositioned.key);
});

check("a title match cannot steal a clip that belongs to another row by position", () => {
  // Two tracks both titled "Dub": the clip at B1 must stay at B1.
  const tracks = [t("A1", "Dub"), t("B1", "Dub")];
  const b1 = clip("vB1", { position: "B1", title: "Dub" });
  const order = runningOrder(b1, detail(tracks), [b1]);
  assert.equal(order.rows[0].playable, null);
  assert.equal(order.rows[1].playable.key, b1.key);
});

check("headings without a position are dropped", () => {
  const withHeadings = [t("", "Side A"), ...TRACKS.slice(0, 2), t("", "Side B"), ...TRACKS.slice(2)];
  const order = runningOrder(A1, detail(withHeadings), [A1]);
  assert.deepEqual(order.rows.map((r) => r.title), ["Melon Ball", "Rind", "Seed", "Pip"]);
});

check("a release with no positions at all keeps every entry", () => {
  const order = runningOrder(A1, detail([t("", "One"), t("", "Two")]), []);
  assert.deepEqual(order.rows.map((r) => r.title), ["One", "Two"]);
});

check("without a tracklist, clips are ordered by position", () => {
  const order = runningOrder(A1, null, [B2, A2, A1, RIP]);
  assert.deepEqual(order.rows.map((r) => r.position), ["A1", "A2", "B2"]);
  assert.deepEqual(order.extras.map((c) => c.key), [RIP.key]);
});

check("a record previewed from outside the crate still lists itself", () => {
  const outside = clip("vOut", { position: "A1", title: "Melon Ball", releaseId: RELEASE });
  const order = runningOrder(outside, detail(TRACKS), []);
  assert.equal(order.rows[0].playable.key, outside.key);
  assert.equal(order.rows[0].current, true);
});

check("positions sort the way a record is pressed", () => {
  assert.deepEqual(["B1", "A10", "A2"].sort(comparePositions), ["A2", "A10", "B1"]);
  assert.ok(comparePositions("A2", "A10") < 0, "A2 before A10");
  assert.ok(comparePositions("A10", "B1") < 0, "A10 before B1");
  assert.ok(comparePositions("2", "10") < 0, "2 before 10");
});

check("the queue is the playable tracks, in order", () => {
  const order = runningOrder(A2, detail(TRACKS), [B2, A2, A1]);
  assert.deepEqual(recordQueue(order).map((c) => c.position), ["A1", "A2", "B2"]);
});

/* ---- the detour ---- */

console.log("\nleaving the shuffle and coming back");

const SHUFFLE = ["s0", "s1", "s2", "s3"];

check("the shuffle picks up at the track after the one you left", () => {
  // You were on s1 when you went to explore its record, and the record almost
  // always contains it. Resuming at s1 plays it twice in a row.
  const detour = beginDetour(null, SHUFFLE, 1, "Melon Ball EP");
  assert.deepEqual(resumePoint(detour, false), { queue: SHUFFLE, index: 2 });
});

check("digging into a second record still returns you to the shuffle", () => {
  // One saved position, not a stack: "back" means back to where you were,
  // not back to the first record you wandered into.
  const first = beginDetour(null, SHUFFLE, 1, "Melon Ball EP");
  const second = beginDetour(first, ["r0", "r1", "r2"], 2, "Another EP");
  assert.equal(second.label, "Another EP");
  assert.deepEqual(resumePoint(second, false), { queue: SHUFFLE, index: 2 });
});

check("the saved shuffle is a copy, safe from later changes", () => {
  const live = [...SHUFFLE];
  const detour = beginDetour(null, live, 0, "x");
  live.length = 0;
  assert.equal(detour.queue.length, 4);
});

check("leaving from the last track wraps with repeat on", () => {
  const detour = beginDetour(null, SHUFFLE, 3, "x");
  assert.equal(resumePoint(detour, true).index, 0);
});

check("and stays on the last track with repeat off", () => {
  const detour = beginDetour(null, SHUFFLE, 3, "x");
  assert.equal(resumePoint(detour, false).index, 3);
});

check("nothing to return to is said plainly", () => {
  assert.equal(resumePoint(beginDetour(null, [], 0, "x"), false), null);
});

check("the detour ends when the record runs out, not before", () => {
  assert.equal(detourEnds(2, 1, 4), false);
  assert.equal(detourEnds(3, 1, 4), true);
  // Going backwards inside the record never leaves it.
  assert.equal(detourEnds(0, -1, 4), false);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} record tests failed.`);
  process.exit(1);
}
console.log(`\nAll ${ran} record tests passed.`);
