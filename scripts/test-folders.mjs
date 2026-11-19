/**
 * Discogs folders on the records, and the Folder filter.
 *
 *   npm run test:folders
 *
 * The thing to pin: "only" and "hide" do what they say, a record whose
 * folders aren't known is never hidden by either, a record with copies in two
 * folders is in both however the listing paged them, the standing choice
 * comes back as written and a bad or outdated one is ignored, the filter sits
 * in the crate's filter pipeline like every other facet — and a folder name,
 * which can say more than a genre does ("Sell", "Mum's"), can't leave the
 * browser on a playlist entry or in an export file.
 */
import assert from "node:assert/strict";
import { choosableFolders, folderNamesFor, inFolders, knownFolders, listedBeforeFolders, mergeFolderIds, withFolders } from "../src/client/folders.ts";
import { parseFolderPreference, serializeFolderPreference } from "../src/client/folderPreference.ts";
import { applyFilters, computeFacets, emptyFilters, folderChoices, pivotTo, toggleFolder } from "../src/client/filters.ts";
import { fileEntry } from "../src/client/playlistFile.ts";
import { playlistItemSchema } from "../src/lib/validation.ts";
import { folderIdOf } from "../src/lib/folderId.ts";
import { readFileSync } from "node:fs";

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

const FOLDERS = [
  { id: 0, name: "All", count: 6 },
  { id: 1, name: "Uncategorized", count: 4 },
  { id: 2, name: "Listening", count: 1 },
  { id: 3, name: "DJ", count: 1 },
];

const row = (releaseId, extra = {}) => ({
  key: `${releaseId}:${"a".repeat(11)}`,
  releaseId,
  videoId: "a".repeat(11),
  title: `Track ${releaseId}`,
  artist: "Someone",
  releaseTitle: `Record ${releaseId}`,
  year: 2000,
  genres: ["Electronic"],
  styles: [],
  labels: [],
  thumb: "",
  country: null,
  formats: ["Vinyl"],
  duration: null,
  position: "A1",
  bpm: null,
  matchKind: "track",
  silence: null,
  addedAt: null,
  ...extra,
});

console.log("\nfolders on the rows");

check("a folder id is a positive whole number; anything else is 'not known', never an error", () => {
  assert.equal(folderIdOf(1), 1);
  assert.equal(folderIdOf(8675309), 8675309);
  for (const odd of [0, -1, 1.5, "2", null, undefined, NaN, Infinity, {}, [3], true]) {
    assert.equal(folderIdOf(odd), null, `value ${JSON.stringify(odd)}`);
  }
});

check("folder 0 (All) is not a choice", () => {
  assert.deepEqual(choosableFolders(FOLDERS).map((f) => f.name), ["Uncategorized", "Listening", "DJ"]);
});

check("ids become names; an id with no name, or no ids, is not known", () => {
  assert.deepEqual(folderNamesFor([2, 3], FOLDERS), ["Listening", "DJ"]);
  assert.deepEqual(folderNamesFor([1, 1], FOLDERS), ["Uncategorized"]);
  assert.equal(folderNamesFor([99], FOLDERS), undefined);
  assert.equal(folderNamesFor([], FOLDERS), undefined);
  assert.equal(folderNamesFor(undefined, FOLDERS), undefined);
  assert.equal(folderNamesFor([2], []), undefined, "no folder list yet: nothing can be said");
});

check("rows carry their record's folder names; a record not in the map is left alone", () => {
  const ids = new Map([
    [101, [1]],
    [104, [2]],
  ]);
  const rows = withFolders([row(101), row(104), row(301)], ids, FOLDERS);
  assert.deepEqual(rows[0].folders, ["Uncategorized"]);
  assert.deepEqual(rows[1].folders, ["Listening"]);
  assert.equal(rows[2].folders, undefined, "a want has no folder");
  assert.equal(withFolders([row(101)], new Map(), FOLDERS)[0].folders, undefined, "nothing known: rows untouched");
});

check("two copies on different pages of the listing: the record is in both folders", () => {
  const seen = new Map();
  const first = mergeFolderIds([{ id: 7, folderIds: [3] }, { id: 8, folderIds: [1] }], seen);
  assert.deepEqual(first.map((s) => s.folderIds), [[3], [1]]);
  const second = mergeFolderIds([{ id: 7, folderIds: [2] }, { id: 9, folderIds: [1] }], seen);
  assert.deepEqual(second.find((s) => s.id === 7).folderIds, [3, 2], "the later page carries the earlier copy's folder too");
  assert.deepEqual(second.find((s) => s.id === 9).folderIds, [1]);
  // The same folder twice is still one folder, and a want is left alone.
  const third = mergeFolderIds([{ id: 7, folderIds: [3] }, { id: 50 }], seen);
  assert.deepEqual(third[0].folderIds, [3, 2]);
  assert.equal("folderIds" in third[1], false);
  // A new run starts from nothing: a copy moved out of a folder is not remembered.
  assert.deepEqual(mergeFolderIds([{ id: 7, folderIds: [2] }], new Map())[0].folderIds, [2]);
});

check("a crate cached before folders were read is re-listed once; one read since never is", () => {
  assert.equal(listedBeforeFolders([{ id: 1 }, { id: 2 }]), true);
  assert.equal(listedBeforeFolders([{ id: 1, folderIds: [] }, { id: 2 }]), false, "an empty list is still 'read by this version'");
  assert.equal(listedBeforeFolders([{ id: 1, folderIds: [3] }]), false);
  assert.equal(listedBeforeFolders([]), false, "nothing listed yet: the sync will do it");
});

console.log("\nonly, hide, unknown");

check("only: a copy in any selected folder; hide: gone when every copy is in a hidden one", () => {
  const listening = { folders: ["Listening"] };
  const both = { folders: ["Listening", "DJ"] };
  const dj = { folders: ["DJ"] };
  const selected = new Set(["Listening"]);
  assert.equal(inFolders(listening, selected, false), true);
  assert.equal(inFolders(both, selected, false), true);
  assert.equal(inFolders(dj, selected, false), false);
  assert.equal(inFolders(listening, selected, true), false);
  assert.equal(inFolders(both, selected, true), true, "a copy in a folder that isn't hidden keeps the record in");
  assert.equal(inFolders(dj, selected, true), true);
  assert.equal(inFolders(both, new Set(["Listening", "DJ"]), true), false, "both of its folders hidden: gone");
});

check("the two modes agree: what 'only DJ' shows, 'hide Listening' never takes away", () => {
  const shelf = [{ folders: ["DJ"] }, { folders: ["Listening"] }, { folders: ["Listening", "DJ"] }, { folders: ["Sell"] }, {}];
  const onlyDj = shelf.filter((r) => inFolders(r, new Set(["DJ"]), false));
  const hideListening = shelf.filter((r) => inFolders(r, new Set(["Listening"]), true));
  for (const record of onlyDj) assert.ok(hideListening.includes(record), JSON.stringify(record));
});

check("a record whose folders aren't known passes both ways; nothing selected passes all", () => {
  const unknown = {};
  assert.equal(inFolders(unknown, new Set(["Listening"]), false), true);
  assert.equal(inFolders(unknown, new Set(["Listening"]), true), true);
  assert.equal(inFolders({ folders: ["DJ"] }, new Set(), true), true);
});

console.log("\nin the crate's filters");

const CRATE = withFolders(
  [row(101), row(102), row(104), row(301)],
  new Map([
    [101, [1]],
    [102, [1, 3]],
    [104, [2]],
  ]),
  FOLDERS,
);

check("the Folder facet counts tracks per folder, most first", () => {
  assert.deepEqual(computeFacets(CRATE).folders, [
    ["Uncategorized", 2],
    ["DJ", 1],
    ["Listening", 1],
  ]);
});

check("hide Listening is the whole crate minus the listening album (and the want stays)", () => {
  const kept = applyFilters(CRATE, { ...emptyFilters, folders: ["Listening"], hideFolders: true });
  assert.deepEqual(kept.map((r) => r.releaseId), [101, 102, 301]);
});

check("only DJ is the DJ record alone, plus anything whose folders aren't known", () => {
  const kept = applyFilters(CRATE, { ...emptyFilters, folders: ["DJ"], hideFolders: false });
  assert.deepEqual(kept.map((r) => r.releaseId), [102, 301]);
});

check("the Folder filter stacks with the others", () => {
  const kept = applyFilters(CRATE, { ...emptyFilters, folders: ["Listening"], hideFolders: true, query: "record 102" });
  assert.deepEqual(kept.map((r) => r.releaseId), [102]);
});

check("a crate that sits in one folder has no Folder group; a ticked folder always shows", () => {
  assert.deepEqual(folderChoices([["Uncategorized", 2000]], []), [], "everything in Uncategorized: nothing to choose between");
  assert.deepEqual(folderChoices([], []), []);
  assert.deepEqual(folderChoices([["Uncategorized", 1990], ["Listening", 10]], []).length, 2);
  assert.deepEqual(folderChoices([["DJ", 2000]], ["DJ"]), [["DJ", 2000]], "ticked, so it can be unticked");
});

check("unticking the last folder puts the switch back to 'only', and the filters back to empty", () => {
  const hiding = { ...emptyFilters, folders: ["Listening"], hideFolders: true };
  const two = toggleFolder(hiding, "DJ");
  assert.deepEqual([two.folders, two.hideFolders], [["Listening", "DJ"], true], "a second folder keeps the mode");
  const one = toggleFolder(two, "DJ");
  assert.deepEqual([one.folders, one.hideFolders], [["Listening"], true]);
  const none = toggleFolder(one, "Listening");
  assert.deepEqual(none, emptyFilters, "nothing selected is exactly the empty filters, so Reset has nothing left to offer");
  assert.equal(toggleFolder(emptyFilters, "DJ").hideFolders, false, "and the next tick starts at 'only'");
});

check("a pivot from Dig or a tag clears the filters of the moment and keeps the Folder choice", () => {
  const busy = { ...emptyFilters, query: "shiva", styles: ["Deep House"], decades: ["1990s"], withBpmOnly: true, folders: ["Listening"], hideFolders: true };
  assert.deepEqual(pivotTo(busy, "labels", "Infra"), { ...emptyFilters, labels: ["Infra"], folders: ["Listening"], hideFolders: true });
  assert.deepEqual(pivotTo(busy, "tags", "deep"), { ...emptyFilters, tags: ["deep"], folders: ["Listening"], hideFolders: true });
  assert.deepEqual(pivotTo(emptyFilters, "styles", "Techno"), { ...emptyFilters, styles: ["Techno"] });
  // Onto a folder itself: that folder, shown — whatever was hidden before.
  assert.deepEqual(pivotTo(busy, "folders", "DJ"), { ...emptyFilters, folders: ["DJ"], hideFolders: false });
});

console.log("\nthe standing choice");

check("the choice comes back as written, for the account that made it", () => {
  const note = serializeFolderPreference({ folders: ["Listening"], hide: true }, "tito");
  assert.deepEqual(parseFolderPreference(note, "tito"), { folders: ["Listening"], hide: true });
});

check("another login on the same device gets no choice — and none of the names", () => {
  const note = serializeFolderPreference({ folders: ["Mum's — do not sell"], hide: true }, "tito");
  assert.equal(parseFolderPreference(note, "someone_else"), null);
  assert.equal(parseFolderPreference(note, "Tito"), null, "usernames are compared exactly");
  assert.equal(parseFolderPreference(JSON.stringify({ v: 1, folders: ["DJ"], hide: false }), "tito"), null, "a note that names nobody is nobody's");
  assert.equal(parseFolderPreference(JSON.stringify({ v: 1, user: ["tito"], folders: ["DJ"] }), "tito"), null);
});

check("garbage, the wrong shape, or an empty choice is no choice", () => {
  for (const raw of [null, "", "{", "[]", "null", '"tito"', '{"v":2,"user":"tito","folders":["a"]}', '{"v":1,"user":"tito","folders":[]}', '{"v":1,"user":"tito","folders":[1,2]}', '{"v":1,"user":"tito","folders":"DJ"}']) {
    assert.equal(parseFolderPreference(raw, "tito"), null, `raw ${JSON.stringify(raw)}`);
  }
});

check("names are deduplicated, bounded and never blank", () => {
  const back = parseFolderPreference(JSON.stringify({ v: 1, user: "tito", folders: ["DJ", "DJ", "   ", "x".repeat(81), "Listening"], hide: "yes" }), "tito");
  assert.deepEqual(back, { folders: ["DJ", "Listening"], hide: false });
  const many = parseFolderPreference(JSON.stringify({ v: 1, user: "tito", folders: Array.from({ length: 100 }, (_, i) => `f${i}`) }), "tito");
  assert.equal(many.folders.length, 60);
});

check("a folder renamed or removed on Discogs drops out of the choice; an unread list drops nothing", () => {
  assert.deepEqual(knownFolders(["Listening", "Gone"], FOLDERS), ["Listening"]);
  assert.deepEqual(knownFolders(["Gone"], FOLDERS), []);
  assert.deepEqual(knownFolders(["All"], FOLDERS), [], "folder 0 was never a choice");
  assert.deepEqual(knownFolders(["Listening", "Gone"], []), ["Listening", "Gone"], "no list read: nothing can be said");
});

console.log("\nwhere folder names can't go");

check("the folders route reads the session and nothing else from the request", () => {
  const code = readFileSync("src/app/api/discogs/folders/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /requireUser\(request\)/, "every request is checked for a current session");
  assert.match(code, /getCollectionFolders\(\{[^}]*\},\s*session\.u\)/, "the username asked for is the session's");
  assert.match(code, /rateLimit\(/);
  for (const reach of ["searchParams", "nextUrl", ".json()", ".text()", "formData", "headers", "params", "cookies"]) {
    assert.ok(!code.includes(reach), `the route must not read ${reach}`);
  }
  assert.deepEqual([...code.matchAll(/export async function (\w+)/g)].map((m) => m[1]), ["GET"], "read-only: one GET, no write");
});

check("an export file can't carry a folder name", () => {
  const entry = fileEntry({
    clipKey: `101:${"a".repeat(11)}`,
    releaseId: 101,
    videoId: "a".repeat(11),
    title: "T",
    artist: "A",
    releaseTitle: "R",
    year: 1999,
    folders: ["Mum's — do not sell"],
  });
  assert.ok(!JSON.stringify(entry).includes("do not sell"));
});

check("the playlist API refuses an entry that tries to bring folders along", () => {
  const entry = {
    clipKey: `101:${"a".repeat(11)}`,
    releaseId: 101,
    videoId: "a".repeat(11),
    title: "T",
    artist: "A",
    releaseTitle: "R",
    year: 1999,
  };
  assert.equal(playlistItemSchema.safeParse(entry).success, true);
  assert.equal(playlistItemSchema.safeParse({ ...entry, folders: ["Sell"] }).success, false);
  assert.equal(playlistItemSchema.safeParse({ ...entry, folderIds: [2] }).success, false);
});

console.log(`\n${ran - failed}/${ran} folder tests passed.`);
if (failed > 0) process.exit(1);
