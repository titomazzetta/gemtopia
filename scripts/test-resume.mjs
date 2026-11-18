/**
 * Picking up where you left off (client/resume.ts) and the remembered search
 * (client/searchMemory.ts).
 *
 *   npm run test:resume
 *
 * Both notes live in localStorage, which anything on the origin can write,
 * so the thing to pin is that a note is read back exactly, that a wrong,
 * stale or foreign one is ignored rather than thrown on, and that a plan is
 * only made from what the device actually holds.
 */
import assert from "node:assert/strict";
import {
  RESUME_MAX_AGE_MS,
  parseSnapshot,
  resumePlan,
  serializeSnapshot,
} from "../src/client/resume.ts";
import { parseSearch, serializeSearch, SEARCH_MEMORY_MAX_AGE_MS } from "../src/client/searchMemory.ts";

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

const NOW = 1_800_000_000_000;
const PLAYLIST = "0f0e0d0c-1111-4222-8333-444455556666";
const note = (over = {}) => ({
  at: NOW - 60_000,
  user: "tito",
  source: "collection",
  playlistId: PLAYLIST,
  key: "4242:vA1vA1vA1vA",
  position: 183.4,
  searchOpen: true,
  ...over,
});

console.log("\nthe note");

check("a note comes back exactly as written", () => {
  const back = parseSnapshot(serializeSnapshot(note()), NOW, "tito");
  assert.deepEqual(back, { v: 1, ...note() });
});

check("nothing, garbage, or the wrong shape is simply no note", () => {
  for (const raw of [null, undefined, "", "{", "[]", "42", '{"v":2}', '{"v":1,"at":"x"}']) {
    assert.equal(parseSnapshot(raw, NOW, "tito"), null, `raw ${JSON.stringify(raw)}`);
  }
});

check("a note older than twelve hours is forgotten, and one from the future too", () => {
  assert.equal(parseSnapshot(serializeSnapshot(note({ at: NOW - RESUME_MAX_AGE_MS - 1 })), NOW, "tito"), null);
  assert.notEqual(parseSnapshot(serializeSnapshot(note({ at: NOW - RESUME_MAX_AGE_MS + 1000 })), NOW, "tito"), null);
  assert.equal(parseSnapshot(serializeSnapshot(note({ at: NOW + 120_000 })), NOW, "tito"), null);
});

check("someone else's note on the same device is ignored", () => {
  assert.equal(parseSnapshot(serializeSnapshot(note()), NOW, "komron"), null);
});

check("a bad playlist id or clip key is dropped, not the whole note", () => {
  const back = parseSnapshot(serializeSnapshot(note({ playlistId: "../etc", key: "<script>" })), NOW, "tito");
  assert.equal(back.playlistId, null);
  assert.equal(back.key, null);
  assert.equal(back.searchOpen, true);
});

check("a position is a non-negative number of seconds, capped at a day", () => {
  assert.equal(parseSnapshot(serializeSnapshot(note({ position: -5 })), NOW, "tito").position, 0);
  assert.equal(parseSnapshot(serializeSnapshot(note({ position: 1e9 })), NOW, "tito").position, 86400);
  assert.equal(parseSnapshot(JSON.stringify({ v: 1, ...note(), position: "deep" }), NOW, "tito").position, 0);
});

check("an unknown source is no note", () => {
  assert.equal(parseSnapshot(JSON.stringify({ v: 1, ...note(), source: "everything" }), NOW, "tito"), null);
});

console.log("\nthe plan");

const have = { playlistIds: new Set([PLAYLIST]), keys: new Set(["4242:vA1vA1vA1vA", "7:t.B2"]) };

check("everything the device still holds is restored", () => {
  const plan = resumePlan(parseSnapshot(serializeSnapshot(note()), NOW, "tito"), have);
  assert.deepEqual(plan, {
    source: "collection",
    playlistId: PLAYLIST,
    cue: { key: "4242:vA1vA1vA1vA", position: 183.4 },
    searchOpen: true,
  });
});

check("a set that is gone is not opened; the clip still is", () => {
  const plan = resumePlan(parseSnapshot(serializeSnapshot(note()), NOW, "tito"), { ...have, playlistIds: new Set() });
  assert.equal(plan.playlistId, null);
  assert.deepEqual(plan.cue, { key: "4242:vA1vA1vA1vA", position: 183.4 });
});

check("a clip the crate no longer has is not cued; the set still opens", () => {
  const plan = resumePlan(parseSnapshot(serializeSnapshot(note()), NOW, "tito"), { ...have, keys: new Set() });
  assert.equal(plan.cue, null);
  assert.equal(plan.playlistId, PLAYLIST);
});

check("nothing to restore is no plan at all", () => {
  const snapshot = parseSnapshot(serializeSnapshot(note({ playlistId: null, key: null, searchOpen: false })), NOW, "tito");
  assert.equal(resumePlan(snapshot, have), null);
  assert.equal(resumePlan(null, have), null);
});

console.log("\nthe remembered search");

const hit = {
  id: 990001,
  artist: "Unknown Artist",
  title: "Mirror Dance",
  year: 1996,
  thumb: "https://i.discogs.com/x.jpg",
  labels: ["White"],
  genres: ["Electronic"],
  styles: ["Techno"],
  country: "US",
  formats: ["Vinyl"],
  catno: "CAT-100",
  barcodes: ["0123456789012"],
  have: 420,
  want: 1200,
};

check("a search comes back as it was: query, field and the rows", () => {
  const back = parseSearch(serializeSearch({ query: "mirror", field: "track", hits: [hit] }, NOW - 1000), NOW);
  assert.equal(back.query, "mirror");
  assert.equal(back.field, "track");
  assert.deepEqual(back.hits, [hit]);
});

check("a stale search, an unknown field or an empty query is forgotten", () => {
  assert.equal(parseSearch(serializeSearch({ query: "mirror", field: "all", hits: [] }, NOW - SEARCH_MEMORY_MAX_AGE_MS - 1), NOW), null);
  assert.equal(parseSearch(JSON.stringify({ v: 1, at: NOW, query: "x", field: "mood", hits: [] }), NOW), null);
  assert.equal(parseSearch(JSON.stringify({ v: 1, at: NOW, query: "   ", field: "all", hits: [] }), NOW), null);
  assert.equal(parseSearch("not json", NOW), null);
});

check("a row that isn't a search hit is dropped; the others stay", () => {
  const back = parseSearch(
    JSON.stringify({ v: 1, at: NOW, query: "m", field: "all", hits: [hit, { id: "7" }, null, { id: 5, artist: "A" }] }),
    NOW,
  );
  assert.equal(back.hits.length, 1);
});

check("a thumbnail must be an https URL; anything else is no thumbnail", () => {
  const back = parseSearch(JSON.stringify({ v: 1, at: NOW, query: "m", field: "all", hits: [{ ...hit, thumb: "javascript:alert(1)" }] }), NOW);
  assert.equal(back.hits[0].thumb, "");
});

check("oversized text and lists are cut rather than kept", () => {
  const back = parseSearch(
    JSON.stringify({ v: 1, at: NOW, query: "m", field: "all", hits: [{ ...hit, title: "x".repeat(301) }, { ...hit, labels: Array(40).fill("L") }] }),
    NOW,
  );
  assert.equal(back.hits.length, 1, "a 301-character title is not a hit");
  assert.equal(back.hits[0].labels.length, 20);
});

check("at most a hundred rows are remembered", () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ ...hit, id: i + 1 }));
  const back = parseSearch(serializeSearch({ query: "m", field: "all", hits: many }, NOW), NOW);
  assert.equal(back.hits.length, 100);
});

console.log(`\n${ran - failed}/${ran} resume tests passed.`);
if (failed > 0) process.exit(1);
