/**
 * How collaborative playlists present themselves (src/client/collabView.ts).
 *
 *   npm run test:collab-view
 */
import assert from "node:assert/strict";
import { canRemoveEntry, collabLine, isCollabPlaylist } from "../src/client/collabView.ts";

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

const mine = { role: "owner", owner: "Tito", collaborators: [], joinLinkOn: false };

check("a private playlist is not marked", () => {
  assert.equal(isCollabPlaylist(mine), false);
  assert.equal(collabLine(mine, "Tito"), null);
});

check("a join link out marks it, before anyone joins", () => {
  const p = { ...mine, joinLinkOn: true };
  assert.equal(isCollabPlaylist(p), true);
  assert.equal(collabLine(p, "Tito"), "Collab · link out, nobody's joined yet");
});

check("someone joining marks it, and names them", () => {
  const p = { ...mine, collaborators: ["Komron"] };
  assert.equal(isCollabPlaylist(p), true);
  assert.equal(collabLine(p, "Tito"), "Collab with Komron");
});

check("one you joined is always marked, and names the owner first", () => {
  const p = { role: "editor", owner: "Komron", collaborators: ["Tito", "kochjk2"], joinLinkOn: false };
  assert.equal(isCollabPlaylist(p), true);
  assert.equal(collabLine(p, "tito"), "Collab with Komron, kochjk2");
});

check("long lists are shortened", () => {
  const p = { ...mine, collaborators: ["a", "b", "c", "d"] };
  assert.equal(collabLine(p, "Tito"), "Collab with a, b +2");
});

check("the owner is offered remove on every record", () => {
  assert.equal(canRemoveEntry("owner", "someone", "Tito"), true);
  assert.equal(canRemoveEntry("owner", null, "Tito"), true);
});

check("a collaborator is offered remove only on their own records", () => {
  assert.equal(canRemoveEntry("editor", "Komron", "komron"), true, "case doesn't matter");
  assert.equal(canRemoveEntry("editor", "Tito", "komron"), false);
  assert.equal(canRemoveEntry("editor", null, "komron"), false);
  assert.equal(canRemoveEntry("editor", undefined, "komron"), false);
});

console.log(`\n${ran - failed}/${ran} collab view tests passed.`);
if (failed > 0) process.exit(1);
