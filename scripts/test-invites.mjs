/**
 * Invite-code tests: the pure half (src/lib/invite-code.ts).
 *
 *   npm run test:invites
 *
 * The database half — single use under a race, expiry, revocation — is in
 * test-api.mjs, because only Postgres can prove a row lock holds.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  INVITE_ALPHABET,
  admit,
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  inviteKey,
  inviteStatus,
  normaliseInviteCode,
  parseLifetime,
} from "../src/lib/invite-code.ts";

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

/* -- generating ---------------------------------------------------------- */

check("a code is XXXX-XXXX from the alphabet", () => {
  for (let i = 0; i < 500; i += 1) {
    const code = generateInviteCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    for (const ch of code.replace("-", "")) assert.ok(INVITE_ALPHABET.includes(ch), ch);
  }
});

check("the alphabet has no look-alikes", () => {
  for (const ch of "01ILO") assert.ok(!INVITE_ALPHABET.includes(ch), ch);
  assert.equal(new Set(INVITE_ALPHABET).size, INVITE_ALPHABET.length);
  assert.equal(INVITE_ALPHABET.length, 31);
});

check("bytes that would bias the draw are thrown away", () => {
  // 248..255 must be skipped; 0 maps to "A", 30 to "9", 31 wraps to "A".
  let call = 0;
  const feed = (size) => {
    call += 1;
    const out = new Uint8Array(size).fill(255);
    if (call === 1) out.set([248, 0, 255, 30, 31, 249, 1, 2, 3, 4, 5]);
    return out;
  };
  assert.equal(generateInviteCode(feed), "A9AB-CDEF");
});

check("a drought of unusable bytes keeps drawing rather than returning short", () => {
  let call = 0;
  const feed = (size) => {
    call += 1;
    return call < 3 ? new Uint8Array(size).fill(250) : new Uint8Array(size).fill(2);
  };
  assert.equal(generateInviteCode(feed), "CCCC-CCCC");
});

check("codes do not repeat in practice", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) seen.add(generateInviteCode());
  assert.equal(seen.size, 5000);
});

check("every letter turns up at roughly the same rate", () => {
  const counts = new Map();
  const draws = 20000;
  for (let i = 0; i < draws; i += 1) {
    for (const ch of generateInviteCode().replace("-", "")) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
  }
  const expected = (draws * 8) / 31;
  for (const ch of INVITE_ALPHABET) {
    const n = counts.get(ch) ?? 0;
    assert.ok(Math.abs(n - expected) / expected < 0.08, `${ch}: ${n} vs ${expected}`);
  }
});

check("format puts the dash in the middle", () => {
  assert.equal(formatInviteCode("ABCDEFGH"), "ABCD-EFGH");
});

/* -- reading what people typed ----------------------------------------- */

check("what people actually type is accepted", () => {
  for (const typed of ["ABCD-EFGH", "abcd-efgh", "abcdefgh", " ABCD EFGH ", "AB-CD-EF-GH"]) {
    assert.equal(normaliseInviteCode(typed), "ABCDEFGH", typed);
  }
});

check("anything that cannot be a code is refused", () => {
  for (const typed of [
    "",
    "ABCD-EFG",
    "ABCD-EFGHJ",
    "ABCD-EF0H", // 0 is not in the alphabet
    "ABCD-EFIH", // nor is I
    "ABCD-EFGH'",
    "' OR 1=1 --",
    "ABCD_EFGH",
    "ÄBCD-EFGH",
    "A".repeat(33),
  ]) {
    assert.equal(normaliseInviteCode(typed), null, JSON.stringify(typed));
  }
});

check("non-strings are refused", () => {
  for (const value of [null, undefined, 12345678, ["ABCDEFGH"], { code: "ABCDEFGH" }]) {
    assert.equal(normaliseInviteCode(value), null);
  }
});

check("a generated code survives its own normaliser", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generateInviteCode();
    assert.equal(normaliseInviteCode(code), code.replace("-", ""));
    assert.equal(normaliseInviteCode(code.toLowerCase()), code.replace("-", ""));
  }
});

/* -- storing ------------------------------------------------------------ */

const SECRET = randomBytes(32).toString("base64url");

check("the stored form is a 64-char hex HMAC, not the code", () => {
  const hash = hashInviteCode("ABCDEFGH", inviteKey(SECRET));
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes("ABCDEFGH"));
});

check("same code, same key: same hash (so lookup works)", () => {
  const key = inviteKey(SECRET);
  assert.equal(hashInviteCode("ABCDEFGH", key), hashInviteCode("ABCDEFGH", key));
});

check("a different server secret gives a different hash", () => {
  const other = randomBytes(32).toString("base64url");
  assert.notEqual(
    hashInviteCode("ABCDEFGH", inviteKey(SECRET)),
    hashInviteCode("ABCDEFGH", inviteKey(other)),
  );
});

check("the invite key is derived, not the session key itself", () => {
  const key = inviteKey(SECRET);
  assert.equal(key.length, 32);
  assert.notDeepEqual(key, Buffer.from(SECRET, "base64url"));
});

/* -- lifetimes --------------------------------------------------------- */

check("only an hour or a day", () => {
  assert.equal(parseLifetime(1), 1);
  assert.equal(parseLifetime(24), 24);
  for (const value of [0, 2, 23, 25, 168, -1, 1.5, "1", "24", null, undefined, Infinity]) {
    assert.equal(parseLifetime(value), null, String(value));
  }
});

/* -- who gets in -------------------------------------------------------- */

const cases = [
  // member,               admin, inviteOnly, code  → decision
  [null, false, false, false, "enter"],
  [null, false, false, true, "enter"], // open sign-up doesn't spend codes
  [null, false, true, false, "not_invited"],
  [null, false, true, true, "redeem"],
  [null, true, true, false, "enter"],
  [{ revoked: false }, false, true, false, "enter"], // grandfathered
  [{ revoked: false }, false, true, true, "enter"], // code left unspent
  [{ revoked: true }, false, true, false, "removed"],
  [{ revoked: true }, false, false, false, "removed"], // removal outlives invite-only
  [{ revoked: true }, false, true, true, "redeem"],
  [{ revoked: true }, true, true, false, "enter"],
];

for (const [member, isAdmin, inviteOnly, hasCode, expected] of cases) {
  check(
    `admit: member=${member ? (member.revoked ? "removed" : "yes") : "new"} ` +
      `admin=${isAdmin} inviteOnly=${inviteOnly} code=${hasCode} → ${expected}`,
    () => assert.equal(admit({ member, isAdmin, inviteOnly, hasCode }), expected),
  );
}

/* -- status ------------------------------------------------------------- */

check("status reads used, revoked, expired, live in that order", () => {
  const now = 1_000_000;
  const row = (over) => ({ usedAt: null, revokedAt: null, expiresAt: now + 1, ...over });
  assert.equal(inviteStatus(row({}), now), "live");
  assert.equal(inviteStatus(row({ expiresAt: now }), now), "expired");
  assert.equal(inviteStatus(row({ revokedAt: 1 }), now), "revoked");
  assert.equal(inviteStatus(row({ usedAt: 1, expiresAt: 0 }), now), "used");
});

console.log(`\n${ran - failed}/${ran} invite tests passed.`);
if (failed > 0) process.exit(1);
