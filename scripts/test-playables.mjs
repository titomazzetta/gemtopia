/**
 * Playable-building and de-duplication tests.
 *
 *   node --experimental-strip-types scripts/test-playables.mjs
 *
 * Discogs attaches videos to releases rather than tracks, and uploaders are
 * enthusiastic. Before de-duplication a 4-track EP with a full-album rip and
 * three alternate uploads of the same remix rendered as fourteen near-identical
 * rows. These cases pin the collapsing rules, and — more importantly — pin that
 * collapsing never discards the *best* clip, only the worse copies.
 */
import assert from "node:assert/strict";
import {
  buildPlayables,
  countSilence,
  distinct,
  pendingPlayables,
  playableOnly,
  queueFrom,
} from "../src/client/playables.ts";

/** A real /releases/{id} fetch always carries marketplace data. */
const MARKET = { forSale: 3, lowestPrice: 12.5, have: 400, want: 900 };

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

let videoSeq = 0;
const video = (title, duration) => ({
  id: `vid${String(videoSeq++).padStart(8, "0")}`.slice(0, 11),
  title,
  duration,
});

const track = (position, title, duration) => ({
  position,
  title,
  duration,
  artists: [],
});

const release = (over = {}) => ({
  id: 1001,
  title: "Kinetic",
  artist: "Golden Girls",
  year: 1994,
  genres: ["Electronic"],
  styles: ["Trance"],
  labels: ["Distinctive"],
  formats: ["Vinyl", '12"'],
  country: "UK",
  thumb: "",
  coverImage: "",
  notes: null,
  tracks: [],
  videos: [],
  market: null,
  fetchedAt: Date.now(),
  ...over,
});

/* -- the reported case --------------------------------------------------- */

check("Golden Girls — Kinetic: sixteen uploads become one row", () => {
  // The reported case, with the exact runtimes from the screenshot. Every clip
  // matched track A, and Discogs carries no duration for it — so nothing but
  // the uploads themselves says how long this record is.
  const runtimes = [
    "4:42", "3:14", "3:38", "5:49", "4:26", "4:38", "8:21", "6:58",
    "6:25", "7:28", "5:29", "5:47", "6:04", "6:22", "9:46", "8:41",
  ].map((mmss) => {
    const [m, s] = mmss.split(":").map(Number);
    return m * 60 + s;
  });

  const items = buildPlayables([
    release({
      title: "Kinetic",
      artist: "Golden Girls",
      year: 1992,
      genres: ["Electronic"],
      styles: ["House"],
      // No duration on the tracklist — which is the norm, and the whole reason
      // the median rule exists.
      tracks: [track("A", "Kinetic (Remixed By Frank De Wulf)", null)],
      videos: runtimes.map((seconds) =>
        video("Golden Girls - Kinetic (Frank De Wulf Remix)", seconds),
      ),
    }),
  ]);

  assert.equal(items.length, 1, `expected 1 row, got ${items.length}`);
  assert.equal(items[0].title, "Kinetic (Remixed By Frank De Wulf)");

  // The median of those sixteen is 5:56. The winner must be near it — not the
  // 3:14 radio edit and not the 9:46 rip.
  assert.ok(
    items[0].duration >= 5 * 60 && items[0].duration <= 7 * 60,
    `picked ${items[0].duration}s, expected something near the 5:56 median`,
  );
});

check("the median rule ignores a lone outlier", () => {
  const items = buildPlayables([
    release({
      tracks: [track("A1", "Warehouse", null)],
      videos: [
        video("Warehouse", 360),
        video("Warehouse", 358),
        video("Warehouse", 364),
        video("Warehouse", 3600), // someone's four-hour continuous mix
      ],
    }),
  ]);
  assert.equal(items.length, 1);
  assert.ok(items[0].duration < 400, `kept the outlier: ${items[0].duration}s`);
});

check("Discogs' own duration still wins over the uploads' median", () => {
  // Three uploads agree on ~6 min, but the pressing says 3:00. Trust Discogs.
  const items = buildPlayables([
    release({
      tracks: [track("A1", "Short Edit", "3:00")],
      videos: [
        video("Short Edit", 360),
        video("Short Edit", 362),
        video("Short Edit", 180),
      ],
    }),
  ]);
  assert.equal(items[0].duration, 180);
});

/* -- collapsing rules ---------------------------------------------------- */

check("two clips matching the same track collapse", () => {
  const items = buildPlayables([
    release({
      tracks: [track("A1", "Sunset Boulevard", "5:00")],
      videos: [video("Artist - Sunset Boulevard", 300), video("Sunset Boulevard", 301)],
    }),
  ]);
  assert.equal(items.length, 1);
});

check("distinct tracks stay distinct", () => {
  const items = buildPlayables([
    release({
      tracks: [
        track("A1", "Sunset Boulevard", "5:00"),
        track("B1", "Midnight Chrome", "6:30"),
      ],
      videos: [
        video("Artist - Sunset Boulevard", 300),
        video("Artist - Midnight Chrome", 390),
      ],
    }),
  ]);
  assert.equal(items.length, 2);
  assert.deepEqual(
    items.map((i) => i.title).sort(),
    ["Midnight Chrome", "Sunset Boulevard"],
  );
});

check("unmatched clips with the same title collapse", () => {
  const items = buildPlayables([
    release({
      tracks: [],
      videos: [
        video("Some Untitled Jam", 240),
        video("Some Untitled Jam", 241),
      ],
    }),
  ]);
  assert.equal(items.length, 1);
});

check("unmatched clips with different titles do not collapse", () => {
  const items = buildPlayables([
    release({
      tracks: [],
      videos: [
        video("Warehouse Dub", 240),
        video("Completely Different Thing", 600),
      ],
    }),
  ]);
  assert.equal(items.length, 2);
});

check("same runtime and near-identical title collapses across groups", () => {
  // Two uploads of one recording that happened to match different tracklist
  // entries — caught by the runtime + title rule rather than by track identity.
  const items = buildPlayables([
    release({
      tracks: [
        track("A1", "Kinetic", "6:12"),
        track("A2", "Kinetic Reprise", "6:12"),
      ],
      videos: [
        video("Golden Girls - Kinetic", 372),
        video("Golden Girls - Kinetic ", 372),
      ],
    }),
  ]);
  assert.equal(items.length, 1);
});

check("same runtime but genuinely different titles are kept apart", () => {
  const items = buildPlayables([
    release({
      tracks: [],
      videos: [
        video("Warehouse Dub", 300),
        video("Basement Pressure", 300),
      ],
    }),
  ]);
  assert.equal(items.length, 2);
});

/* -- picking the best clip, not an arbitrary one -------------------------- */

check("the clip whose runtime matches the pressing wins", () => {
  const items = buildPlayables([
    release({
      tracks: [track("A1", "Velvet Static", "4:00")],
      videos: [
        video("Artist - Velvet Static (full album)", 3600),
        video("Artist - Velvet Static", 240),
      ],
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].duration, 240);
});

check("clip order does not decide the winner", () => {
  // Same inputs, reversed. A stable rule must give the same answer.
  const forward = buildPlayables([
    release({
      tracks: [track("A1", "Velvet Static", "4:00")],
      videos: [video("Velvet Static", 240), video("Velvet Static full album", 3600)],
    }),
  ]);
  const backward = buildPlayables([
    release({
      tracks: [track("A1", "Velvet Static", "4:00")],
      videos: [video("Velvet Static full album", 3600), video("Velvet Static", 240)],
    }),
  ]);
  assert.equal(forward[0].duration, 240);
  assert.equal(backward[0].duration, 240);
});

check("a timed clip beats an untimed one", () => {
  const items = buildPlayables([
    release({
      tracks: [track("A1", "Nocturne", "3:30")],
      videos: [video("Nocturne", null), video("Nocturne", 210)],
    }),
  ]);
  assert.equal(items[0].duration, 210);
});

/* -- BPM is not lost when a duplicate is discarded ------------------------ */

check("a BPM catalogued against a discarded duplicate is inherited", () => {
  const good = video("Kinetic", 372);
  const dupe = video("Kinetic ", 372);
  const items = buildPlayables(
    [release({ tracks: [track("A1", "Kinetic", "6:12")], videos: [good, dupe] })],
    // The tempo was tapped against the copy that loses.
    new Map([[`1001:${dupe.id}`, 138]]),
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].bpm, 138, "tapped tempo was thrown away with the duplicate");
});

check("the winner's own BPM wins over an inherited one", () => {
  const good = video("Kinetic", 372);
  const dupe = video("Kinetic ", 372);
  const items = buildPlayables(
    [release({ tracks: [track("A1", "Kinetic", "6:12")], videos: [good, dupe] })],
    new Map([
      [`1001:${good.id}`, 140],
      [`1001:${dupe.id}`, 138],
    ]),
  );
  assert.equal(items[0].bpm, 140);
});

/* -- nothing gets lost --------------------------------------------------- */

check("a release with one clip is untouched", () => {
  const items = buildPlayables([
    release({ tracks: [track("A1", "Solo", "4:00")], videos: [video("Solo", 240)] }),
  ]);
  assert.equal(items.length, 1);
});

/* ---- silent records ---------------------------------------------------
 *
 * This block replaces a test that asserted the opposite: "a release with no
 * clips yields nothing, not a placeholder". That was deliberate and it was
 * wrong. It meant a record you owned, had synced successfully, and could see
 * on Discogs simply did not exist in the app, with nothing on screen
 * admitting it. One marked row is the honest version.
 */

check("a release with no clips now yields one row, not nothing", () => {
  const items = buildPlayables([release({ videos: [], market: MARKET })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].videoId, null);
});

check("a fetched release with no videos is no-audio, not not-loaded", () => {
  const [item] = buildPlayables([release({ videos: [], market: MARKET })]);
  assert.equal(item.silence, "no-audio");
});

check("a sync placeholder is not-loaded, and never claims Discogs has no audio", () => {
  // market === null is the tell: a real /releases/{id} fetch always returns
  // num_for_sale and lowest_price, so a null market can only be a row the
  // sync wrote without ever reaching the release.
  const [item] = buildPlayables([release({ videos: [], market: null })]);
  assert.equal(
    item.silence,
    "not-loaded",
    "told the user Discogs has no audio for a record we never actually looked at",
  );
});

check("the silence invariant holds for every emitted row", () => {
  const items = buildPlayables([
    release({ id: 1, tracks: [track("A1", "One", "3:00")], videos: [video("One", 180)] }),
    release({ id: 2, videos: [], market: MARKET }),
    release({ id: 3, videos: [], market: null }),
  ]);
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(
      item.silence === null,
      item.videoId !== null,
      `${item.key} disagrees with itself about whether it can be played`,
    );
  }
});

check("a silent row keeps the metadata the crate filters on", () => {
  const [item] = buildPlayables([release({ videos: [], market: MARKET })]);
  // It has to be filterable and sortable, or showing it achieves nothing.
  assert.equal(item.styles[0], "Trance");
  assert.equal(item.labels[0], "Distinctive");
  assert.equal(item.year, 1994);
  assert.equal(item.country, "UK");
});

check("a silent key cannot collide with a real clip key", () => {
  // Real video ids are 11 characters from [A-Za-z0-9_-], so "silent" is not
  // reachable as one.
  const [item] = buildPlayables([release({ id: 77, videos: [], market: MARKET })]);
  assert.equal(item.key, "77:silent");
});

/* ---- queueing ---------------------------------------------------------- */

check("playableOnly drops exactly the silent rows", () => {
  const items = buildPlayables([
    release({ id: 1, tracks: [track("A1", "One", "3:00")], videos: [video("One", 180)] }),
    release({ id: 2, videos: [], market: MARKET }),
  ]);
  const playable = playableOnly(items);
  assert.equal(playable.length, 1);
  assert.equal(playable[0].releaseId, 1);
});

check("queueFrom re-derives the index rather than reusing it", () => {
  // The row pressed is at index 2 on screen but index 1 in the queue, because
  // a silent record sits above it. Reusing the screen index plays the wrong
  // record, which is the sort of off-by-one nobody notices in review.
  const items = buildPlayables([
    release({ id: 1, tracks: [track("A1", "One", "3:00")], videos: [video("One", 180)] }),
    release({ id: 2, videos: [], market: MARKET }),
    release({ id: 3, tracks: [track("A1", "Three", "3:00")], videos: [video("Three", 180)] }),
  ]);
  assert.equal(items[2].releaseId, 3);

  const plan = queueFrom(items, 2);
  assert.ok(plan);
  assert.equal(plan.index, 1);
  assert.equal(plan.queue[plan.index].releaseId, 3, "queued the wrong record");
});

check("queueFrom refuses when the row pressed is itself silent", () => {
  const items = buildPlayables([
    release({ id: 1, tracks: [track("A1", "One", "3:00")], videos: [video("One", 180)] }),
    release({ id: 2, videos: [], market: MARKET }),
  ]);
  assert.equal(queueFrom(items, 1), null);
});

check("queueFrom refuses when nothing in the list can be played", () => {
  const items = buildPlayables([
    release({ id: 1, videos: [], market: MARKET }),
    release({ id: 2, videos: [], market: null }),
  ]);
  assert.equal(queueFrom(items, 0), null);
});

check("no silent record can ever reach a queue", () => {
  const items = buildPlayables([
    release({ id: 1, videos: [], market: MARKET }),
    release({ id: 2, tracks: [track("A1", "Two", "3:00")], videos: [video("Two", 180)] }),
    release({ id: 3, videos: [], market: null }),
  ]);
  const plan = queueFrom(items, 1);
  assert.ok(plan);
  for (const item of plan.queue) {
    assert.notEqual(item.videoId, null, "a silent record got into the queue");
  }
});

check("countSilence splits the two kinds, because they lead somewhere different", () => {
  const items = buildPlayables([
    release({ id: 1, tracks: [track("A1", "One", "3:00")], videos: [video("One", 180)] }),
    release({ id: 2, videos: [], market: MARKET }),
    release({ id: 3, videos: [], market: null }),
    release({ id: 4, videos: [], market: null }),
  ]);
  assert.deepEqual(countSilence(items), {
    playable: 1,
    noAudio: 1,
    notLoaded: 2,
    loading: 0,
  });
});

const summary = (over = {}) => ({
  id: 501, title: "Moneyshot EP", artist: "Rob & Si", year: 2004,
  genres: ["Electronic"], styles: ["Tech House", "tech house"], labels: ["Drugsex", "Drugsex"],
  formats: ["Vinyl"], country: "US", artistIds: [1], labelIds: [2],
  addedAt: "2026-01-02T00:00:00Z", thumb: "t.jpg", coverImage: "", ...over,
});

check("records the sync hasn't reached yet show as loading rows, never playable", () => {
  const rows = pendingPlayables([summary()], new Set());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].silence, "loading");
  assert.equal(rows[0].videoId, null);
  assert.equal(rows[0].releaseId, 501);
  assert.equal(rows[0].addedAt, "2026-01-02T00:00:00Z", "sorts by date added like everything else");
  assert.deepEqual(rows[0].labels, ["Drugsex"], "one of each label, as for detailed rows");
  assert.deepEqual(rows[0].styles, ["Tech House"]);
  assert.equal(queueFrom(rows, 0), null, "a loading row never reaches the queue");
});

check("a record already detailed never also appears as loading", () => {
  const rows = pendingPlayables([summary(), summary({ id: 502 }), summary()], new Set([501]));
  assert.deepEqual(rows.map((r) => r.releaseId), [502]);
});

check("countSilence reports loading separately from not synced", () => {
  const items = [...pendingPlayables([summary(), summary({ id: 503 })], new Set())];
  assert.deepEqual(countSilence(items), { playable: 0, noAudio: 0, notLoaded: 0, loading: 2 });
});

check("every emitted key is unique", () => {
  const items = buildPlayables([
    release({
      id: 1,
      tracks: [track("A1", "One", "3:00"), track("A2", "Two", "3:00")],
      videos: [video("One", 180), video("Two", 180), video("One again", 180)],
    }),
    release({
      id: 2,
      tracks: [track("A1", "Three", "3:00")],
      videos: [video("Three", 180)],
    }),
  ]);
  const keys = items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate clip keys emitted");
});

check("releases do not collapse into each other", () => {
  // Identical titles and runtimes on two different pressings must stay apart.
  const items = buildPlayables([
    release({ id: 1, tracks: [], videos: [video("Kinetic", 372)] }),
    release({ id: 2, tracks: [], videos: [video("Kinetic", 372)] }),
  ]);
  assert.equal(items.length, 2);
});

check("a label listed once per catalogue number appears once", () => {
  // Discogs: "Network Records – NWKT 44" and "Network Records – NWKT 44X".
  const [item] = buildPlayables([
    release({
      labels: ["Network Records", "Network Records"],
      styles: ["Deep House", "deep house ", "House"],
      genres: ["Electronic", "Electronic"],
      videos: [video("Kinetic", 372)],
    }),
  ]);
  assert.deepEqual(item.labels, ["Network Records"]);
  assert.deepEqual(item.styles, ["Deep House", "House"]);
  assert.deepEqual(item.genres, ["Electronic"]);
});

check("distinct keeps the first spelling and drops blanks", () => {
  assert.deepEqual(distinct(["Svek", " svek", "", "  ", "Peacefrog"]), ["Svek", "Peacefrog"]);
});

/* ------------------------------------------------------------------------ */

if (failed > 0) {
  console.error(`\n${failed} of ${ran} playable tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} playable tests passed.`);
