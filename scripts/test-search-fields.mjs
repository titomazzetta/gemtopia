/**
 * Search field tests.
 *
 *   npm run test:search
 *
 * Discogs treats q, track, catno and barcode as different searches rather
 * than as hints, so the thing worth pinning is that what leaves the browser
 * is the search the user actually asked for.
 */
import assert from "node:assert/strict";
import {
  SEARCH_FIELDS,
  searchQueryFor,
  specFor,
  tooShortMessage,
} from "../src/client/searchFields.ts";

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

check("the default field searches artist and release title", () => {
  assert.equal(searchQueryFor("all", "aphex twin"), "q=aphex+twin");
});

check("a track search does not go out as q", () => {
  // The whole point of the field: q never looks at tracklists, so sending a
  // track name as q is the bug this exists to fix.
  const query = searchQueryFor("track", "windowlicker");
  assert.equal(query, "track=windowlicker");
  assert.ok(!query.startsWith("q="), "track search went out as a title search");
});

check("catalogue number and barcode keep their own parameters", () => {
  assert.equal(searchQueryFor("catno", "PF-045"), "catno=PF-045");
  assert.equal(searchQueryFor("barcode", "5021392"), "barcode=5021392");
});

check("exactly one parameter is ever sent", () => {
  for (const spec of SEARCH_FIELDS) {
    const query = searchQueryFor(spec.key, "abcdefgh");
    assert.equal(
      [...new URLSearchParams(query).keys()].length,
      1,
      `${spec.key} sent more than one parameter`,
    );
  }
});

check("a value containing & or = cannot smuggle in a second parameter", () => {
  const query = searchQueryFor("all", "rock & roll=yes");
  const params = new URLSearchParams(query);
  assert.equal([...params.keys()].length, 1);
  assert.equal(params.get("q"), "rock & roll=yes");
});

check("too-short input returns null rather than a doomed request", () => {
  // The route answers 400, and that 400 costs one of sixty requests a minute
  // shared with collection sync.
  assert.equal(searchQueryFor("all", "a"), null);
  assert.equal(searchQueryFor("all", "   "), null);
  assert.equal(searchQueryFor("track", "x"), null);
  assert.equal(searchQueryFor("barcode", "12345"), null);
});

check("a catalogue number of one character is allowed through", () => {
  // Short catalogue numbers are real; the minimum differs per field for a
  // reason and must not be flattened to a single global rule.
  assert.equal(searchQueryFor("catno", "7"), "catno=7");
});

check("surrounding whitespace never reaches Discogs", () => {
  assert.equal(searchQueryFor("all", "  boards of canada  "), "q=boards+of+canada");
});

check("every field has a placeholder that names what it searches", () => {
  for (const spec of SEARCH_FIELDS) {
    assert.ok(spec.placeholder.length > 0, `${spec.key} has no placeholder`);
    assert.ok(spec.label.length <= 8, `${spec.key} label is too long for a pill`);
  }
});

check("specFor falls back rather than throwing on an unknown field", () => {
  assert.equal(specFor("nonsense").key, "all");
});

check("the too-short message matches the field's own minimum", () => {
  assert.match(tooShortMessage("barcode"), /6/);
  assert.match(tooShortMessage("catno"), /catalogue number/i);
});

console.log(`\n${ran - failed}/${ran} search field tests passed.`);
if (failed > 0) process.exit(1);
