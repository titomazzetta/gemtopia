/**
 * Scanning a sleeve: the pure rules (src/lib/sleeve.ts).
 *
 *   npm run test:sleeve
 *
 * The model's answer is untrusted text; the searches it earns are the ones a
 * person could have typed; the ranking puts your own copy first. The route's
 * checks (size, type, key, rate) are in test-api.mjs.
 */
import assert from "node:assert/strict";
import {
  SURE_SCORE,
  barcodeForms,
  normaliseBarcode,
  normaliseCatno,
  ownershipLabel,
  rankCandidates,
  readFromBarcode,
  readFromModel,
  searchesFor,
} from "../src/lib/sleeve.ts";

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

const hit = (id, extra = {}) => ({
  id,
  artist: "Moodymann",
  title: "Silentintroduction",
  year: 1997,
  labels: ["Planet E"],
  catno: "PE 65225-1",
  barcodes: [],
  formats: ["Vinyl", "2xLP"],
  ...extra,
});
const sets = (collection = [], wantlist = []) => ({ collection: new Set(collection), wantlist: new Set(wantlist) });

console.log("\nwhat a read is");

check("barcodes keep digits only, in the three lengths that exist", () => {
  assert.equal(normaliseBarcode("5 020105 123456"), "5020105123456");
  assert.equal(normaliseBarcode(5020105123456), "5020105123456");
  assert.equal(normaliseBarcode("0 12345 67890 5"), "012345678905");
  assert.equal(normaliseBarcode("1234"), null, "too short to be a barcode");
  assert.equal(normaliseBarcode("not a barcode"), null);
  // UPC-A is EAN-13 with a leading zero: a 12-digit read also tries the
  // 13-digit form, and a 13-digit read starting with 0 also tries the 12.
  assert.deepEqual(barcodeForms("123456789012"), ["123456789012", "0123456789012"]);
  assert.deepEqual(barcodeForms("0123456789012"), ["0123456789012", "123456789012"]);
  assert.deepEqual(barcodeForms("5020105123456"), ["5020105123456"], "a real EAN has one form");
  assert.deepEqual(barcodeForms("12345678"), ["12345678"], "EAN-8 has one form");
});

check("a catalogue number is tidied, not rewritten", () => {
  assert.equal(normaliseCatno("  KDJ  44 "), "KDJ 44");
  assert.equal(normaliseCatno("#PF-045."), "PF-045");
  assert.equal(normaliseCatno(": KDJ-44 :"), "KDJ-44");
  assert.equal(normaliseCatno("#"), null);
  assert.equal(normaliseCatno(null), null);
});

check("the model's JSON becomes a read, cleaned and bounded", () => {
  const read = readFromModel({
    barcode: "5 020105 123456",
    catno: " KDJ 44 ",
    label: "KDJ\u202E",
    artist: "Moodymann",
    title: "x".repeat(900),
    year: "1997",
    confidence: 1.7,
    extra: "ignored",
  });
  assert.equal(read.barcode, "5020105123456");
  assert.equal(read.catno, "KDJ 44");
  assert.equal(read.label, "KDJ", "a bidi override is stripped");
  assert.equal(Array.from(read.title).length, 200, "cut to the limit");
  assert.equal(read.year, 1997);
  assert.equal(read.confidence, 1, "clamped");
  assert.equal(read.source, "model");
});

check("a read with nothing to search for is no read", () => {
  assert.equal(readFromModel({}), null);
  assert.equal(readFromModel({ label: "KDJ", year: 1997 }), null, "a label alone finds nothing exact");
  assert.equal(readFromModel("nope"), null);
  assert.equal(readFromModel({ barcode: "12" }), null);
  assert.ok(readFromModel({ title: "Shiva" }));
});

check("a barcode the phone decoded is a read of its own", () => {
  assert.deepEqual(readFromBarcode("5020105123456"), {
    barcode: "5020105123456", catno: null, label: null, artist: null, title: null, year: null, confidence: 1, source: "barcode-scanner",
  });
  assert.equal(readFromBarcode("abc"), null);
});

console.log("\nthe searches a read earns");

check("most exact first: barcode, then catalogue number, then words", () => {
  const read = readFromModel({ barcode: "5020105123456", catno: "KDJ 44", artist: "Moodymann", title: "Silentintroduction" });
  assert.deepEqual(searchesFor(read).map((s) => s.by), ["barcode", "catno", "text"]);
  assert.deepEqual(searchesFor(read)[2].params, { q: "Moodymann Silentintroduction" });
  assert.equal(searchesFor(readFromModel({ catno: "KDJ 44" })).length, 1);
  assert.deepEqual(searchesFor(readFromModel({ title: "Shiva" })).map((s) => s.params), [{ q: "Shiva" }]);
});

check("each search says what it is, for the card", () => {
  const read = readFromModel({ barcode: "5020105123456", catno: "KDJ 44", artist: "Moodymann" });
  assert.deepEqual(searchesFor(read).map((s) => s.says), ["Barcode 5020105123456", "Cat # KDJ 44", "Reads “Moodymann”"]);
});

console.log("\nranking the hits");

check("a barcode hit is near-certain; your own copy comes first", () => {
  const read = readFromModel({ barcode: "5020105123456" });
  const ranked = rankCandidates(
    read,
    [hit(1, { barcodes: ["5 020105 123456"] }), hit(2, { barcodes: ["5020105123456"] }), hit(3, { barcodes: ["999"] })],
    "barcode",
    sets([2]),
  );
  assert.deepEqual(ranked.map((c) => c.hit.id), [2, 1, 3]);
  assert.equal(ranked[0].reason, "Barcode matches");
  assert.equal(ranked[0].ownership, "collection");
  assert.ok(ranked[0].score >= SURE_SCORE && ranked[1].score >= SURE_SCORE);
  assert.equal(ranked[2].reason, "Barcode 5020105123456", "Discogs matched it even if it didn't echo it");
});

check("a UPC read matches an EAN stored with the leading zero", () => {
  const read = readFromModel({ barcode: "123456789012" });
  const [top] = rankCandidates(read, [hit(1, { barcodes: ["0123456789012"] })], "barcode", sets());
  assert.equal(top.reason, "Barcode matches");
});

check("a catalogue number is strong, and the words then break ties", () => {
  const read = readFromModel({ catno: "PE 65225-1", artist: "Moodymann", title: "Silentintroduction" });
  const ranked = rankCandidates(
    read,
    [hit(1, { catno: "PE65225-1", artist: "Someone Else", title: "Other" }), hit(2, { catno: "pe 65225 1" })],
    "catno",
    sets(),
  );
  assert.deepEqual(ranked.map((c) => c.hit.id), [2, 1]);
  assert.equal(ranked[0].reason, "Cat # pe 65225 1");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.ok(ranked[1].score >= SURE_SCORE, "the catalogue number alone is still sure");
});

check("a words-only read is only as sure as the overlap", () => {
  const read = readFromModel({ artist: "Moodymann", title: "Silentintroduction" });
  const ranked = rankCandidates(
    read,
    [hit(1, { artist: "Theo Parrish", title: "Parallel Dimensions" }), hit(2), hit(3, { title: "Silent Introduction (Reissue)", artist: "Moodymann" })],
    "text",
    sets(),
  );
  assert.equal(ranked[0].hit.id, 2);
  assert.equal(ranked[0].reason, "Title and artist match");
  assert.ok(ranked[0].score < SURE_SCORE, "words alone are never 'sure': the card asks");
  assert.equal(ranked[1].hit.id, 3);
  assert.equal(ranked[1].reason, "Reads like this record");
  assert.equal(ranked[2].hit.id, 1);
  assert.equal(ranked[2].reason, "Nearest Discogs match");
  assert.ok(ranked[2].score < SURE_SCORE);
});

check("vinyl edges out the CD of the same record; a wantlist copy beats a stranger", () => {
  const read = readFromModel({ catno: "PE 65225-1" });
  const ranked = rankCandidates(
    read,
    [hit(1, { formats: ["CD"] }), hit(2, { formats: ["Vinyl"] }), hit(3, { formats: ["CD"] })],
    "catno",
    sets([], [3]),
  );
  assert.deepEqual(ranked.map((c) => c.hit.id), [3, 2, 1]);
  assert.equal(ranked[0].ownership, "wantlist");
});

check("the line under a card", () => {
  assert.equal(ownershipLabel("collection"), "Your copy");
  assert.equal(ownershipLabel("wantlist"), "On your wantlist");
  assert.equal(ownershipLabel("none"), "Not in your collection");
});

console.log(`\n${ran - failed}/${ran} sleeve tests passed.`);
process.exit(failed ? 1 : 0);
