/**
 * Chat envelope-encryption tests.   npm run test:envelope
 *
 * Each check is a property the design claims in src/lib/envelope.ts, tested
 * directly: what a database thief, a tamperer, or a misconfigured deployment
 * can and can't do with what's stored.
 */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  EnvelopeError,
  KEY_ID_PATTERN,
  WRAPPED_KEY_BYTES,
  decodeKey,
  keyId,
  masterKeyRing,
  newDataKey,
  openBytes,
  openMessage,
  sealBytes,
  sealMessage,
  unwrapDataKey,
  wrapDataKey,
} from "../src/lib/envelope.ts";

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

const k = () => randomBytes(32).toString("base64url");
const playlist = randomUUID();
const otherPlaylist = randomUUID();
const alice = randomUUID();
const bob = randomUUID();
const place = (over = {}) => ({ playlistId: playlist, messageId: "1001", kind: "text", ...over });
const payload = (over = {}) => ({ a: alice, b: "Open with Falling Up?", m: null, ...over });
const fails = (fn) => assert.throws(fn, EnvelopeError);

/* ---- primitives -------------------------------------------------- */

check("seal → open round-trips", () => {
  const key = newDataKey();
  const aad = Buffer.from("ctx");
  assert.equal(openBytes(key, sealBytes(key, Buffer.from("hello"), aad), aad).toString(), "hello");
});

check("the plaintext is nowhere in the ciphertext", () => {
  const key = newDataKey();
  const secret = "DROP TABLE nothing — just a very recognisable sentence";
  const blob = sealMessage(key, place(), payload({ b: secret }));
  assert.equal(blob.includes(Buffer.from(secret)), false);
  assert.equal(blob.includes(Buffer.from("very recognisable")), false);
});

check("a fresh nonce every time: the same message never seals the same twice", () => {
  const key = newDataKey();
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) {
    const blob = sealMessage(key, place(), payload());
    const nonce = blob.subarray(1, 13).toString("hex");
    assert.equal(seen.has(nonce), false, "nonce repeated");
    seen.add(nonce);
  }
});

check("one flipped bit anywhere is detected: version, nonce, body and tag", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place(), payload());
  for (const at of [0, 1, 12, 13, Math.floor(blob.length / 2), blob.length - 1]) {
    const bad = Buffer.from(blob);
    bad[at] ^= 0x01;
    fails(() => openMessage(key, place(), alice, bad));
  }
});

check("truncated or empty blobs are refused, not crashed on", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place(), payload());
  fails(() => openMessage(key, place(), alice, blob.subarray(0, 20)));
  fails(() => openMessage(key, place(), alice, Buffer.alloc(0)));
  fails(() => openMessage(key, place(), alice, blob.subarray(0, blob.length - 1)));
});

check("the wrong key opens nothing", () => {
  const blob = sealMessage(newDataKey(), place(), payload());
  fails(() => openMessage(newDataKey(), place(), alice, blob));
});

/* ---- AAD: a ciphertext only opens where it was written -------------- */

check("moved to another playlist, it doesn't open", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place(), payload());
  fails(() => openMessage(key, place({ playlistId: otherPlaylist }), alice, blob));
});

check("copied into another row (another id), it doesn't open", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place({ messageId: "1001" }), payload());
  fails(() => openMessage(key, place({ messageId: "1002" }), alice, blob));
});

check("relabelled as another kind (text → note), it doesn't open", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place({ kind: "text" }), payload());
  fails(() => openMessage(key, place({ kind: "added" }), alice, blob));
});

check("re-attributed to someone else in the database, it's refused", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place(), payload({ a: alice }));
  fails(() => openMessage(key, place(), bob, blob));
  // Same person, any capitalisation of the UUID: still theirs.
  assert.equal(openMessage(key, place(), alice.toUpperCase(), blob).b, "Open with Falling Up?");
});

check("an author whose account was deleted (row author NULL) still reads", () => {
  const key = newDataKey();
  const blob = sealMessage(key, place(), payload({ a: alice }));
  assert.equal(openMessage(key, place(), null, blob).b, "Open with Falling Up?");
});

check("a note's metadata is sealed with it and comes back intact", () => {
  const key = newDataKey();
  const meta = { clipKey: "123:abcdefghijk", title: "Shiva", artist: "Kerri Chandler", year: 1998, bpm: 124 };
  const blob = sealMessage(key, place({ kind: "added" }), payload({ b: "added Shiva", m: meta }));
  assert.equal(blob.includes(Buffer.from("Kerri Chandler")), false);
  assert.deepEqual(openMessage(key, place({ kind: "added" }), alice, blob).m, meta);
});

check("context fields can't smuggle a separator to forge another context", () => {
  const key = newDataKey();
  assert.throws(() => sealMessage(key, place({ messageId: "1\u00002" }), payload()), EnvelopeError);
});

/* ---- master keys: wrapping, rotation, configuration ----------------- */

check("a playlist key wraps to 61 bytes and unwraps only for its playlist", () => {
  const ring = masterKeyRing(k(), undefined);
  const dek = newDataKey();
  const wrapped = wrapDataKey(ring.current, playlist, dek);
  assert.equal(wrapped.length, WRAPPED_KEY_BYTES);
  assert.equal(wrapped.includes(dek), false);
  assert.deepEqual(unwrapDataKey(ring, ring.current.id, playlist, wrapped), dek);
  fails(() => unwrapDataKey(ring, ring.current.id, otherPlaylist, wrapped));
});

check("a different master key can't unwrap it", () => {
  const ring = masterKeyRing(k(), undefined);
  const stranger = masterKeyRing(k(), undefined);
  const wrapped = wrapDataKey(ring.current, playlist, newDataKey());
  fails(() => unwrapDataKey(stranger, ring.current.id, playlist, wrapped));
  // Even claiming the stranger's own id: the AAD binds the id that wrapped it.
  fails(() => unwrapDataKey(stranger, stranger.current.id, playlist, wrapped));
});

check("rotation: the old key still unwraps while listed as previous; then re-wraps", () => {
  const oldKey = k();
  const newKey = k();
  const before = masterKeyRing(oldKey, undefined);
  const dek = newDataKey();
  const wrapped = wrapDataKey(before.current, playlist, dek);

  const during = masterKeyRing(newKey, oldKey);
  assert.notEqual(during.current.id, before.current.id);
  const unwrapped = unwrapDataKey(during, before.current.id, playlist, wrapped);
  assert.deepEqual(unwrapped, dek);
  const rewrapped = wrapDataKey(during.current, playlist, unwrapped);

  const after = masterKeyRing(newKey, undefined);
  assert.deepEqual(unwrapDataKey(after, after.current.id, playlist, rewrapped), dek);
  // And once the old key is gone, what it wrapped is gone with it.
  fails(() => unwrapDataKey(after, before.current.id, playlist, wrapped));
});

check("a message sealed before a rotation still opens after it", () => {
  const oldKey = k();
  const before = masterKeyRing(oldKey, undefined);
  const dek = newDataKey();
  const wrapped = wrapDataKey(before.current, playlist, dek);
  const blob = sealMessage(dek, place(), payload());

  const after = masterKeyRing(k(), oldKey);
  const rewrapped = wrapDataKey(after.current, playlist, unwrapDataKey(after, before.current.id, playlist, wrapped));
  const dek2 = unwrapDataKey(after, after.current.id, playlist, rewrapped);
  assert.equal(openMessage(dek2, place(), alice, blob).b, "Open with Falling Up?");
});

check("key ids are stable, distinct, and reveal nothing usable", () => {
  const key = decodeKey(k());
  assert.equal(keyId(key), keyId(Buffer.from(key)));
  assert.match(keyId(key), KEY_ID_PATTERN);
  assert.notEqual(keyId(key), keyId(decodeKey(k())));
  assert.equal(keyId(key).includes(key.toString("base64url").slice(0, 8)), false);
});

check("malformed master keys are refused with a reason", () => {
  assert.throws(() => decodeKey("short"), /32 bytes/);
  assert.throws(() => decodeKey(`${k()}=`), /32 bytes/);
  assert.throws(() => masterKeyRing(k(), "not-a-key"), /32 bytes/);
});

check("listing the same master key twice is refused", () => {
  const key = k();
  assert.throws(() => masterKeyRing(key, key), /twice/);
});

check("an unconfigured master key id is an error, never a guess", () => {
  const ring = masterKeyRing(k(), undefined);
  const wrapped = wrapDataKey(ring.current, playlist, newDataKey());
  fails(() => unwrapDataKey(ring, "AAAAAAAAAAAAAAAA", playlist, wrapped));
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} envelope tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} envelope tests passed.`);
