/**
 * Collaborative playlist rules (src/lib/collab.ts).
 *
 *   npm run test:collab
 *
 * The database half — membership, the 404 wall, version conflicts — is in
 * test-api.mjs.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  MAX_COLLABORATORS,
  can,
  carryAddedBy,
  hashJoinToken,
  isJoinToken,
  removalsNotAllowed,
  safeNextPath,
} from "../src/lib/collab.ts";

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

const token = randomBytes(32).toString("base64url");

check("a real join token has the right shape", () => {
  assert.equal(token.length, 43);
  assert.ok(isJoinToken(token));
});

check("anything else is not a join token", () => {
  for (const v of ["", "short", token + "x", token.slice(1), token.replace(/.$/, "!"), null, 7, [token]]) {
    assert.equal(isJoinToken(v), false, String(v));
  }
});

check("the stored form is a 64-char hex hash, stable, and not the token", () => {
  const h = hashJoinToken(token);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashJoinToken(token));
  assert.ok(!h.includes(token));
  assert.notEqual(h, hashJoinToken(randomBytes(32).toString("base64url")));
});

check("sign-in may return you to a join link", () => {
  assert.equal(safeNextPath(`/join/${token}`), `/join/${token}`);
});

check("and nowhere else — no open redirect", () => {
  for (const v of [
    "/",
    "/api/admin/invites",
    "https://evil.example/join/" + token,
    "//evil.example/join/" + token,
    "/\\evil.example",
    `/join/${token}/../../admin`,
    `/join/${token}?x=1`,
    `/join/${token}#x`,
    `/join/${token.slice(1)}`,
    ` /join/${token}`,
    "javascript:alert(1)",
    null,
    undefined,
    42,
  ]) {
    assert.equal(safeNextPath(v), null, JSON.stringify(v));
  }
});

check("owners can do everything but leave", () => {
  for (const action of [
    "edit-items",
    "remove-any-record",
    "chat",
    "delete-any-message",
    "rename",
    "delete",
    "share-link",
    "manage-join-link",
    "remove-member",
  ]) {
    assert.ok(can("owner", action), action);
  }
  assert.equal(can("owner", "leave"), false);
});

check("editors change the records, chat and can leave — nothing else", () => {
  assert.ok(can("editor", "edit-items"));
  assert.ok(can("editor", "chat"));
  assert.ok(can("editor", "leave"));
  for (const action of [
    "remove-any-record",
    "delete-any-message",
    "rename",
    "delete",
    "share-link",
    "manage-join-link",
    "remove-member",
  ]) {
    assert.equal(can("editor", action), false, action);
  }
});

check("a sensible collaborator cap exists", () => {
  assert.ok(MAX_COLLABORATORS >= 10 && MAX_COLLABORATORS <= 100);
});

check("existing records keep who added them; new ones go to the editor", () => {
  const previous = [
    { clipKey: "1:aaaaaaaaaaa", addedBy: "tito" },
    { clipKey: "2:bbbbbbbbbbb", addedBy: "komron" },
  ];
  assert.deepEqual(
    carryAddedBy(previous, ["2:bbbbbbbbbbb", "3:ccccccccccc", "1:aaaaaaaaaaa"], "friend"),
    ["komron", "friend", "tito"],
  );
});

check("reordering alone changes nobody's credit", () => {
  const previous = [
    { clipKey: "1:aaaaaaaaaaa", addedBy: "a" },
    { clipKey: "2:bbbbbbbbbbb", addedBy: "b" },
    { clipKey: "3:ccccccccccc", addedBy: null },
  ];
  assert.deepEqual(
    carryAddedBy(previous, ["3:ccccccccccc", "1:aaaaaaaaaaa", "2:bbbbbbbbbbb"], "x"),
    [null, "a", "b"],
  );
});

check("a record in the list twice keeps both credits, in order", () => {
  const previous = [
    { clipKey: "1:aaaaaaaaaaa", addedBy: "a" },
    { clipKey: "1:aaaaaaaaaaa", addedBy: "b" },
  ];
  assert.deepEqual(carryAddedBy(previous, ["1:aaaaaaaaaaa", "1:aaaaaaaaaaa", "1:aaaaaaaaaaa"], "c"), ["a", "b", "c"]);
});

check("removing a record drops its credit; nothing leaks onto another", () => {
  const previous = [
    { clipKey: "1:aaaaaaaaaaa", addedBy: "a" },
    { clipKey: "2:bbbbbbbbbbb", addedBy: "b" },
  ];
  assert.deepEqual(carryAddedBy(previous, ["2:bbbbbbbbbbb"], "c"), ["b"]);
  assert.deepEqual(carryAddedBy(previous, [], "c"), []);
});

const A = "1:aaaaaaaaaaa";
const B = "2:bbbbbbbbbbb";
const C = "3:ccccccccccc";

check("a collaborator can reorder anything", () => {
  const previous = [
    { clipKey: A, addedBy: "owner" },
    { clipKey: B, addedBy: "other" },
    { clipKey: C, addedBy: null },
  ];
  assert.equal(removalsNotAllowed(previous, [C, B, A], "friend", false), 0);
});

check("a collaborator can add, and take out what they added", () => {
  const previous = [
    { clipKey: A, addedBy: "owner" },
    { clipKey: B, addedBy: "friend" },
  ];
  assert.equal(removalsNotAllowed(previous, [A, B, C], "friend", false), 0);
  assert.equal(removalsNotAllowed(previous, [A], "friend", false), 0);
});

check("a collaborator cannot take out anyone else's record", () => {
  const previous = [
    { clipKey: A, addedBy: "owner" },
    { clipKey: B, addedBy: "other" },
    { clipKey: C, addedBy: "friend" },
  ];
  assert.equal(removalsNotAllowed(previous, [B, C], "friend", false), 1, "owner's");
  assert.equal(removalsNotAllowed(previous, [A, C], "friend", false), 1, "another collaborator's");
  assert.equal(removalsNotAllowed(previous, [], "friend", false), 2, "clearing the list");
});

check("records from before anyone was credited count as the owner's", () => {
  const previous = [{ clipKey: A, addedBy: null }];
  assert.equal(removalsNotAllowed(previous, [], "friend", false), 1);
  assert.equal(removalsNotAllowed(previous, [], "owner", true), 0);
});

check("swapping someone's record for another is still a removal", () => {
  const previous = [{ clipKey: A, addedBy: "owner" }];
  assert.equal(removalsNotAllowed(previous, [B], "friend", false), 1);
});

check("the owner can take out anything", () => {
  const previous = [
    { clipKey: A, addedBy: "friend" },
    { clipKey: B, addedBy: "other" },
  ];
  assert.equal(removalsNotAllowed(previous, [], "owner", true), 0);
});

check("with a record in twice, a collaborator can take out only their copy", () => {
  const previous = [
    { clipKey: A, addedBy: "owner" },
    { clipKey: A, addedBy: "friend" },
  ];
  assert.equal(removalsNotAllowed(previous, [A], "friend", false), 0);
  assert.equal(removalsNotAllowed(previous, [], "friend", false), 1);
  assert.deepEqual(carryAddedBy(previous, [A], "friend"), ["owner"], "their copy is the one that goes");
});

check("with a record in twice, the owner's removal drops the last copy", () => {
  const previous = [
    { clipKey: A, addedBy: "friend" },
    { clipKey: A, addedBy: "other" },
  ];
  assert.deepEqual(carryAddedBy(previous, [A], "owner"), ["friend"]);
});

console.log(`\n${ran - failed}/${ran} collab tests passed.`);
if (failed > 0) process.exit(1);
