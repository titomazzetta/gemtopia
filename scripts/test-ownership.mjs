/**
 * Ownership indicator tests.
 *
 *   npm run test:ownership
 *
 * Every case here is really the same case: the indicator may report what it
 * knows and must never report what it does not. A "you don't own this" that
 * turns out to be stale is worse than silence, because it is the sentence
 * someone acts on with their wallet out.
 */
import assert from "node:assert/strict";
import { describeOwnership, ownershipFrom, alreadyCollected } from "../src/client/ownership.ts";

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

check("a record in the collection says so", () => {
  assert.equal(
    describeOwnership({ inCollection: true, onWantlist: false }),
    "In your collection",
  );
});

check("a record on the wantlist says so", () => {
  assert.equal(
    describeOwnership({ inCollection: false, onWantlist: true }),
    "On your wantlist",
  );
});

check("owning it beats wanting it", () => {
  // Discogs does not clear a want when you add the release, so both are true
  // more often than you would think. Owning is the fact that changes what you
  // do next.
  assert.equal(
    describeOwnership({ inCollection: true, onWantlist: true }),
    "In your collection",
  );
});

check("a synced index that lacks it says NOTHING, not 'you don't own this'", () => {
  assert.equal(describeOwnership({ inCollection: false, onWantlist: false }), null);
});

check("an unsynced wantlist is silence, never a denial", () => {
  assert.equal(describeOwnership({ inCollection: false, onWantlist: null }), null);
});

check("nothing synced at all is silence", () => {
  assert.equal(describeOwnership({ inCollection: null, onWantlist: null }), null);
});

check("an unsynced collection cannot be spoken for by the wantlist", () => {
  // Knowing it is on the wantlist says nothing about the collection, so the
  // wantlist label is still the honest one.
  assert.equal(
    describeOwnership({ inCollection: null, onWantlist: true }),
    "On your wantlist",
  );
});

check("alreadyCollected is true only on a positive answer", () => {
  assert.equal(alreadyCollected({ inCollection: true, onWantlist: false }), true);
  assert.equal(alreadyCollected({ inCollection: false, onWantlist: false }), false);
  assert.equal(alreadyCollected({ inCollection: null, onWantlist: true }), false);
});

check("an empty set reads as unknown, never as empty", () => {
  // A wantlist nobody has synced and a wantlist with nothing on it are
  // indistinguishable from here. The two mistakes are not symmetrical:
  // "unknown" when it is really empty costs a label nobody misses; "empty"
  // when it was really unsynced tells someone they do not own what they own.
  const state = ownershipFrom({ collection: new Set([1]), wantlist: new Set() }, 1);
  assert.equal(state.inCollection, true);
  assert.equal(state.onWantlist, null);
});

check("a populated set answers both ways", () => {
  const sets = { collection: new Set([1, 2]), wantlist: new Set([3]) };
  assert.deepEqual(ownershipFrom(sets, 2), { inCollection: true, onWantlist: false });
  assert.deepEqual(ownershipFrom(sets, 3), { inCollection: false, onWantlist: true });
  assert.deepEqual(ownershipFrom(sets, 9), { inCollection: false, onWantlist: false });
});

check("a release in neither populated set is still silent", () => {
  const sets = { collection: new Set([1]), wantlist: new Set([2]) };
  assert.equal(describeOwnership(ownershipFrom(sets, 99)), null);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} ownership tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} ownership tests passed.`);
