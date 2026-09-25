/**
 * Dig links tests.
 *
 *   npm run test:dig-links
 *
 * Credits worth following (remixers, producers, writers) and how another
 * version of a record reads. Mastering engineers and sleeve designers are not
 * a place anyone wants to dig, and following the record's own artist again
 * would duplicate a lane that already exists.
 */
import assert from "node:assert/strict";
import { creditRank, pickCredits, roleWord, versionReason } from "../src/lib/digLinks.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};
const c = (id, name, role) => ({ id, name, role });

check("only roles that shape the music count", () => {
  assert.equal(creditRank("Remix"), 0);
  assert.equal(creditRank("Producer"), 1);
  assert.equal(creditRank("Co-producer"), 1);
  assert.equal(creditRank("Written-By"), 2);
  assert.equal(creditRank("Edited By"), 3);
  for (const role of ["Mastered By", "Lacquer Cut By", "Design", "Photography By", "Artwork"]) {
    assert.equal(creditRank(role), null, role);
  }
});

check("remixers come before producers before writers", () => {
  const picked = pickCredits(
    [c(3, "Writer", "Written-By"), c(2, "Prod", "Producer"), c(1, "Mixer", "Remix")],
    [],
    3,
  );
  assert.deepEqual(picked.map((p) => p.id), [1, 2, 3]);
});

check("the record's own artist is never a credit lane", () => {
  const picked = pickCredits([c(10, "Main Guy", "Producer"), c(11, "Other", "Remix")], [10]);
  assert.deepEqual(picked.map((p) => p.id), [11]);
});

check("one entry per person, with their most useful role", () => {
  const picked = pickCredits([c(5, "Kerri", "Written-By"), c(5, "Kerri", "Remix")], []);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].role, "Remix");
});

check("placeholders, missing ids and disambiguation suffixes are handled", () => {
  const picked = pickCredits(
    [c(0, "No Id", "Remix"), c(7, "Various", "Producer"), c(8, "Unknown Artist", "Remix"), c(9, "Moodymann (2)", "Remix")],
    [],
  );
  assert.deepEqual(picked, [{ id: 9, name: "Moodymann", role: "Remix" }]);
});

check("max is respected and never negative", () => {
  const many = [c(1, "a", "Remix"), c(2, "b", "Remix"), c(3, "c", "Remix")];
  assert.equal(pickCredits(many, [], 2).length, 2);
  assert.equal(pickCredits(many, [], -1).length, 0);
});

check("role words for cards", () => {
  assert.equal(roleWord("Remix [Uncredited]"), "remixer");
  assert.equal(roleWord("Producer"), "producer");
  assert.equal(roleWord("Mastered By"), "credit");
});

check("a version says what makes it different", () => {
  assert.equal(
    versionReason({ id: 1, title: "t", label: null, country: "UK", format: '12", Promo', released: "1996-03-00", thumb: "" }),
    'Another version — 12", Promo, UK, 1996',
  );
  assert.equal(
    versionReason({ id: 1, title: "t", label: null, country: null, format: null, released: null, thumb: "" }),
    "Another version of this record",
  );
});

console.log(`${ran - failed}/${ran} dig link tests passed`);
if (failed) process.exit(1);
