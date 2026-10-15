/**
 * Duplicating, exporting and importing playlists.
 *
 *   npm run test:playlist-file
 *
 * A copy has to be tellable from its original in a list, and a file has to
 * come back as the playlist that went out — one set or a whole backup, with
 * nothing in it about the people who built it.
 */
import assert from "node:assert/strict";
import { copyName, PLAYLIST_NAME_MAX } from "../src/lib/playlistCopy.ts";
import { fileSlug, playlistFile, readPlaylistFile } from "../src/client/playlistFile.ts";

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

/* ---- naming a copy ---- */

check("a copy is named for its original", () => {
  assert.equal(copyName("B2B at the Lot", ["B2B at the Lot"]), "B2B at the Lot (copy)");
});

check("a second copy is (copy 2), and so on, skipping names you have", () => {
  const taken = ["Set", "Set (copy)", "Set (copy 2)"];
  assert.equal(copyName("Set", taken), "Set (copy 3)");
  assert.equal(copyName("set", ["SET (COPY)"]), "set (copy 2)", "compared without case");
});

check("copying a copy counts on from the original, never stacks", () => {
  assert.equal(copyName("Set (copy)", ["Set", "Set (copy)"]), "Set (copy 2)");
  assert.equal(copyName("Set (copy 2)", ["Set", "Set (copy)", "Set (copy 2)"]), "Set (copy 3)");
});

check("a long name loses letters, never the suffix, and fits the 80 cap", () => {
  const long = "x".repeat(80);
  const first = copyName(long, [long]);
  assert.equal(first.length, PLAYLIST_NAME_MAX);
  assert.ok(first.endsWith(" (copy)"));
  const second = copyName(long, [long, first]);
  assert.ok(second.endsWith(" (copy 2)") && second.length <= PLAYLIST_NAME_MAX);
});

check("edge spaces don't count, and a blank base still gets a name", () => {
  assert.equal(copyName("  Warm up  ", []), "Warm up (copy)");
  assert.equal(copyName("(copy)", []), "(copy) (copy)");
});

/* ---- the file ---- */

const entry = (n, over = {}) => ({
  clipKey: `${100 + n}:aaaaaaaaaa${n}`,
  releaseId: 100 + n,
  videoId: `aaaaaaaaaa${n}`,
  title: `Track ${n}`,
  artist: "Artist",
  releaseTitle: "Record",
  year: 1998,
  position: n,
  addedBy: "komron",
  bpm: 124,
  bpmBy: "komron",
  ...over,
});
const recordOnly = { ...entry(9), clipKey: "106:t.B2", releaseId: 106, videoId: null, title: "Feel The Fire" };
const set = { name: "B2B at the Lot", entries: [entry(1), entry(2), recordOnly] };
const now = new Date("2026-10-15T20:30:00Z");

check("one playlist is a file named after it", () => {
  assert.equal(playlistFile([set], { now }).filename, "gemtopia-b2b-at-the-lot-2026-10-15.json");
});

check("Export all is a dated backup, even of one playlist", () => {
  assert.equal(playlistFile([set], { all: true, now }).filename, "gemtopia-playlists-2026-10-15.json");
  assert.equal(playlistFile([set, set], { now }).filename, "gemtopia-playlists-2026-10-15.json");
});

check("the file carries the records, in order, and nothing about people", () => {
  const parsed = JSON.parse(playlistFile([set], { now }).json);
  assert.equal(parsed.app, "gemtopia");
  assert.equal(parsed.version, 2);
  assert.equal(parsed.playlists.length, 1);
  const [first] = parsed.playlists;
  assert.equal(first.name, "B2B at the Lot");
  assert.deepEqual(first.entries.map((e) => e.clipKey), ["101:aaaaaaaaaa1", "102:aaaaaaaaaa2", "106:t.B2"]);
  for (const e of first.entries) {
    assert.deepEqual(Object.keys(e).sort(), ["artist", "clipKey", "releaseId", "releaseTitle", "title", "videoId", "year"]);
  }
  assert.ok(!parsed.playlists[0].entries.some((e) => "addedBy" in e || "bpmBy" in e), "no names in the file");
});

check("what goes out comes back: export, then read", () => {
  const back = readPlaylistFile(JSON.parse(playlistFile([set, { ...set, name: "Second" }], { now }).json));
  assert.deepEqual(back.map((p) => p.name), ["B2B at the Lot", "Second"]);
  assert.equal(back[0].entries.length, 3);
  assert.equal(back[0].entries[2].videoId, null, "a record-only track survives the trip");
});

check("anything that isn't an export is null, not a crash", () => {
  for (const raw of [null, 42, "playlists", [], {}, { playlists: "nope" }, { playlists: [] }, { playlists: [null, 7, "x"] }]) {
    assert.equal(readPlaylistFile(raw), null, JSON.stringify(raw));
  }
});

check("names are trimmed and capped; nameless lists are dropped", () => {
  const back = readPlaylistFile({
    playlists: [
      { name: "   ", entries: [] },
      { name: 12, entries: [] },
      { name: `  ${"y".repeat(120)}  `, entries: [] },
    ],
  });
  assert.equal(back.length, 1);
  assert.equal(back[0].name, "y".repeat(PLAYLIST_NAME_MAX));
});

check("missing entries read as an empty list; entries are left for the server to judge", () => {
  const odd = { clipKey: "<script>", releaseId: -1 };
  const back = readPlaylistFile({ playlists: [{ name: "a" }, { name: "b", entries: [odd] }] });
  assert.deepEqual(back[0].entries, []);
  assert.deepEqual(back[1].entries, [odd], "passed through untouched — Zod on the server rejects it");
});

check("file names are plain and never empty", () => {
  assert.equal(fileSlug("Señor Coconut — Live!"), "senor-coconut-live");
  assert.equal(fileSlug("🔥🔥"), "playlist");
  assert.equal(fileSlug("../../etc/passwd"), "etc-passwd");
  assert.ok(fileSlug("a".repeat(200)).length <= 48);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} playlist file tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} playlist file tests passed.`);
