/**
 * Adoption tests - what happens to a record between "add" and "it plays".
 *
 *   npm run test:adopt
 *
 * The share feature shipped broken with a full green suite because its tests
 * asserted the payload contained what I meant it to contain, never what a
 * person would actually receive. These assert the second thing: what the
 * summary store is handed, what the crate ends up holding, and what the
 * sentence on screen says in the case where the add worked and the crate did
 * not change.
 */
import assert from "node:assert/strict";
import {
  summaryOf,
  mergeDetail,
  describeAdoption,
  describePartialAdoption,
} from "../src/client/adopt.ts";

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

/** A detail with every heavy field populated, so omissions are visible. */
function detail(overrides = {}) {
  return {
    id: 12345,
    title: "Polygon Window",
    artist: "Aphex Twin",
    year: 1993,
    genres: ["Electronic"],
    styles: ["IDM", "Techno"],
    labels: ["Warp"],
    formats: ["Vinyl", "LP"],
    country: "UK",
    artistIds: [45],
    labelIds: [23528],
    addedAt: "2026-09-13T00:00:00Z",
    thumb: "https://img.discogs.com/thumb.jpg",
    coverImage: "https://img.discogs.com/cover.jpg",
    tracks: [{ position: "A1", title: "Polygon Window", duration: "4:20" }],
    videos: [{ id: "abc123", title: "Polygon Window", duration: 260 }],
    notes: "Recorded at home. 130 BPM throughout.",
    market: { forSale: 12, lowestPrice: 34.5, have: 900, want: 1200 },
    fetchedAt: 1_757_000_000_000,
    ...overrides,
  };
}

/* ---- summaryOf: the store must stay small ---- */

check("the summary carries every field the index actually faceted on", () => {
  const summary = summaryOf(detail());
  for (const key of [
    "id", "title", "artist", "year", "genres", "styles", "labels",
    "formats", "country", "artistIds", "labelIds", "addedAt", "thumb",
    "coverImage",
  ]) {
    assert.ok(key in summary, `summary lost ${key}, which a facet reads`);
  }
});

check("no heavy detail field can reach the summary store", () => {
  const summary = summaryOf(detail());
  for (const key of ["tracks", "videos", "notes", "market", "fetchedAt"]) {
    assert.ok(
      !(key in summary),
      `${key} reached the summary store - that is how a phone's IndexedDB fills up`,
    );
  }
});

check("the summary has exactly the summary keys, no more", () => {
  // Pins the count too: a field added to ReleaseDetail must not appear here
  // by accident, and a field added to ReleaseSummary must fail loudly until
  // it is projected deliberately.
  assert.equal(Object.keys(summaryOf(detail())).length, 14);
});

check("addedAt defaults to whatever the detail carried", () => {
  assert.equal(summaryOf(detail()).addedAt, "2026-09-13T00:00:00Z");
});

check("the add path can stamp addedAt the release endpoint could not know", () => {
  // A detail fetched from /releases always reports null here — it describes a
  // pressing, not your copy. The add is the one caller that knows better.
  const stamped = summaryOf(detail({ addedAt: null }), "2026-09-13T12:00:00Z");
  assert.equal(stamped.addedAt, "2026-09-13T12:00:00Z");
});

check("stamping addedAt does not mutate the detail it came from", () => {
  const source = detail({ addedAt: null });
  summaryOf(source, "2026-09-13T12:00:00Z");
  assert.equal(source.addedAt, null);
});

/* ---- mergeDetail: adding twice must not duplicate the crate ---- */

check("a new release is appended", () => {
  const next = mergeDetail([detail({ id: 1 })], detail({ id: 2 }));
  assert.deepEqual(next.map((d) => d.id), [1, 2]);
});

check("adding a record you already own replaces rather than duplicates", () => {
  const next = mergeDetail(
    [detail({ id: 1 }), detail({ id: 2, title: "Old" })],
    detail({ id: 2, title: "New" }),
  );
  assert.deepEqual(next.map((d) => d.id), [1, 2]);
  assert.equal(next[1].title, "New", "the copy fetched just now should win");
});

check("merging does not mutate the array React is rendering from", () => {
  const before = [detail({ id: 1 })];
  const snapshot = before.slice();
  mergeDetail(before, detail({ id: 1, title: "Changed" }));
  assert.deepEqual(before, snapshot, "mergeDetail mutated its input");
});

/* ---- describeAdoption: the sentence must match what happened ---- */

check("a playable record is announced as playable", () => {
  assert.match(describeAdoption(detail()), /ready to play/);
});

check("a record with no videos does not claim the crate changed", () => {
  const message = describeAdoption(detail({ videos: [] }));
  assert.ok(
    !/ready to play/.test(message),
    "claimed a record was playable when Discogs has no audio for it",
  );
  assert.match(message, /won't turn up in the crate/);
});

check("both outcomes still confirm the add itself", () => {
  for (const videos of [[], [{ id: "a", title: "t", duration: 1 }]]) {
    assert.match(
      describeAdoption(detail({ videos })),
      /in your collection/,
      "the add succeeded and the message must say so either way",
    );
  }
});

check("a blank title does not produce a sentence starting with a space", () => {
  const message = describeAdoption(detail({ title: "   " }));
  assert.match(message, /^That record /);
});

/* ---- describePartialAdoption: the POST landed even though the GET did not ---- */

check("a failed detail fetch never implies the add failed", () => {
  const message = describePartialAdoption({ title: "Polygon Window" });
  assert.match(message, /is in your collection/);
  assert.ok(
    !/couldn't add|failed to add|not added/i.test(message),
    "implied the add failed when only the follow-up fetch did",
  );
});

check("the partial case tells you when it will resolve itself", () => {
  assert.match(describePartialAdoption({ title: "X" }), /next sync/);
});

console.log(`\n${ran - failed}/${ran} adoption tests passed.`);
if (failed > 0) process.exit(1);
