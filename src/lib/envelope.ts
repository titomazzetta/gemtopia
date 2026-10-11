import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Envelope encryption for chat, as pure functions.
 *
 * Nothing in here reads the environment or the database, so every property
 * the design relies on is checked directly by scripts/test-envelope.mjs:
 * tampering is detected, a ciphertext only opens in the row it was written
 * for, the wrong key opens nothing, and a rotated-out master key still opens
 * what it wrapped until its keys are re-wrapped.
 *
 * The key hierarchy:
 *
 *   master key (KEK)      32 bytes, from CHAT_MASTER_KEY. Lives in the host's
 *        │                secret store, never in the database or its backups.
 *        │ wraps
 *        ▼
 *   playlist key (DEK)    32 random bytes, one per shared playlist, stored only
 *        │                in wrapped form (playlist_chat_keys.wrapped_key).
 *        │ encrypts
 *        ▼
 *   message               AES-256-GCM, one fresh 96-bit nonce per message.
 *
 * Why two layers rather than one key for everything:
 *
 *   - Rotating the master key re-wraps one 61-byte row per playlist. No
 *     message is decrypted or rewritten to rotate it.
 *   - GCM with random nonces is safe for about 2^32 encryptions under one
 *     key. A playlist keeps at most 1,000 messages, so every key stays many
 *     orders of magnitude inside that bound, however large the app grows.
 *   - A database dump, a backup or a SQL injection read yields wrapped keys
 *     and ciphertext. Neither opens without the master key, which is not in
 *     the database.
 *
 * Every ciphertext carries AAD (authenticated, unencrypted context) naming
 * exactly where it belongs. GCM verifies the AAD along with the ciphertext,
 * so a blob copied into another playlist, another row, or relabelled as
 * another kind of message fails to decrypt instead of being shown in the
 * wrong place.
 */

export const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;
/** First byte of every blob. A new algorithm would get a new byte. */
const FORMAT_V1 = 0x01;
/** version + iv + ciphertext of a 32-byte key + tag */
export const WRAPPED_KEY_BYTES = 1 + IV_BYTES + KEY_BYTES + TAG_BYTES;
/** The smallest possible sealed message: version + iv + tag, empty body. */
const MIN_SEALED_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** Thrown for anything that fails to decrypt or verify. One type, no detail. */
export class EnvelopeError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EnvelopeError";
  }
}

export interface MasterKey {
  /** Public fingerprint, stored beside each wrapped key: which master key wrapped it. */
  id: string;
  key: Buffer;
}

export interface MasterKeyRing {
  /** New playlist keys are wrapped with this one. */
  current: MasterKey;
  /** Every configured key, current included, by id. */
  byId: ReadonlyMap<string, MasterKey>;
}

/**
 * A key's public id: an HMAC of a fixed label under the key itself. It
 * identifies the key without revealing anything usable about it (HMAC is a
 * PRF), and two different keys can't plausibly share one. 96 bits.
 */
export function keyId(key: Buffer): string {
  return createHmac("sha256", key).update("gemtopia/key-id/v1").digest().subarray(0, 12).toString("base64url");
}

export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

/** Decode one base64url master key, or explain what is wrong with it. */
export function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(trimmed)) {
    throw new Error("must be 32 bytes, base64url encoded (43 characters)");
  }
  const key = Buffer.from(trimmed, "base64url");
  if (key.length !== KEY_BYTES) throw new Error("must decode to exactly 32 bytes");
  return key;
}

/**
 * The master keys in use: the current one, and any retired ones that may
 * still be needed to unwrap playlist keys until they are re-wrapped.
 * `previous` is a comma-separated list.
 */
export function masterKeyRing(current: string, previous: string | undefined): MasterKeyRing {
  const currentKey = decodeKey(current);
  const ring = new Map<string, MasterKey>();
  const add = (key: Buffer) => {
    const id = keyId(key);
    if (ring.has(id)) throw new Error("the same master key is listed twice");
    ring.set(id, { id, key });
    return ring.get(id)!;
  };
  const head = add(currentKey);
  for (const part of (previous ?? "").split(",")) {
    if (part.trim()) add(decodeKey(part));
  }
  return { current: head, byId: ring };
}

function concatAad(label: string, fields: readonly string[]): Buffer {
  // NUL can't appear in a UUID, a decimal id, a kind or a key id, so the
  // encoding is unambiguous: no two field lists produce the same bytes.
  for (const field of fields) {
    if (field.includes("\u0000")) throw new EnvelopeError("bad context");
  }
  return Buffer.from([label, ...fields].join("\u0000"), "utf8");
}

/** Where a wrapped playlist key belongs. */
export function dataKeyAad(playlistId: string, masterKeyId: string): Buffer {
  return concatAad("gemtopia/chat-key/v1", [playlistId, masterKeyId]);
}

/** Where a sealed message belongs. */
export function messageAad(playlistId: string, messageId: string, kind: string): Buffer {
  return concatAad("gemtopia/chat-message/v1", [playlistId, messageId, kind]);
}

/** AES-256-GCM with a fresh random nonce. Output: version ‖ iv ‖ ciphertext ‖ tag. */
export function sealBytes(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new EnvelopeError("bad key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_V1]), iv, body, cipher.getAuthTag()]);
}

/** Inverse of sealBytes. Throws EnvelopeError for anything that doesn't verify. */
export function openBytes(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  if (key.length !== KEY_BYTES) throw new EnvelopeError("bad key");
  if (!Buffer.isBuffer(blob) || blob.length < MIN_SEALED_BYTES) throw new EnvelopeError("truncated");
  if (blob[0] !== FORMAT_V1) throw new EnvelopeError("unknown format");
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const body = blob.subarray(1 + IV_BYTES, blob.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Wrong key, wrong context, or tampered bytes: indistinguishable on purpose.
    throw new EnvelopeError("does not verify");
  }
}

/** A new random playlist key. */
export function newDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Wrap a playlist key under the current master key. */
export function wrapDataKey(master: MasterKey, playlistId: string, dataKey: Buffer): Buffer {
  if (dataKey.length !== KEY_BYTES) throw new EnvelopeError("bad data key");
  return sealBytes(master.key, dataKey, dataKeyAad(playlistId, master.id));
}

/**
 * Unwrap a playlist key with whichever configured master key wrapped it.
 * A key id that isn't configured (a master key retired too early) is an
 * error, not a guess.
 */
export function unwrapDataKey(
  ring: MasterKeyRing,
  masterKeyId: string,
  playlistId: string,
  wrapped: Buffer,
): Buffer {
  const master = ring.byId.get(masterKeyId);
  if (!master) throw new EnvelopeError("master key not configured");
  if (wrapped.length !== WRAPPED_KEY_BYTES) throw new EnvelopeError("truncated");
  const key = openBytes(master.key, wrapped, dataKeyAad(playlistId, masterKeyId));
  if (key.length !== KEY_BYTES) throw new EnvelopeError("bad data key");
  return key;
}

/** What is encrypted for each message. Kept short: it's stored per row. */
export interface MessagePayload {
  /** Author id when written. Checked against the row on read, see openMessage. */
  a: string | null;
  /** The text. */
  b: string;
  /** A note's metadata; null for a text message. */
  m: Record<string, unknown> | null;
}

export interface MessagePlace {
  playlistId: string;
  messageId: string;
  kind: string;
}

export function sealMessage(dataKey: Buffer, place: MessagePlace, payload: MessagePayload): Buffer {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  return sealBytes(dataKey, plaintext, messageAad(place.playlistId, place.messageId, place.kind));
}

/**
 * Decrypt a message and check it against the row it came from.
 *
 * The playlist, message id and kind are in the AAD, so GCM itself refuses a
 * blob that has been moved. The author is checked here rather than in the
 * AAD because the column is not immutable: deleting an account sets
 * author_id to NULL, and that must not make the person's old messages
 * unreadable. So: a row whose author is NULL accepts any sealed author (the
 * account is gone either way), and a row that names an author must name the
 * one sealed inside. Re-attributing a message to someone else in the
 * database is detected.
 */
export function openMessage(
  dataKey: Buffer,
  place: MessagePlace,
  rowAuthorId: string | null,
  blob: Buffer,
): MessagePayload {
  const plaintext = openBytes(dataKey, blob, messageAad(place.playlistId, place.messageId, place.kind));
  let payload: unknown;
  try {
    payload = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new EnvelopeError("bad payload");
  }
  if (!payload || typeof payload !== "object") throw new EnvelopeError("bad payload");
  const { a, b, m } = payload as Record<string, unknown>;
  if (typeof b !== "string") throw new EnvelopeError("bad payload");
  if (a !== null && typeof a !== "string") throw new EnvelopeError("bad payload");
  if (m !== null && (typeof m !== "object" || Array.isArray(m))) throw new EnvelopeError("bad payload");
  if (rowAuthorId !== null && !sameId(a, rowAuthorId)) throw new EnvelopeError("author mismatch");
  return { a, b, m: m as Record<string, unknown> | null };
}

function sameId(a: string | null, b: string): boolean {
  if (a === null) return false;
  const x = Buffer.from(a.toLowerCase(), "utf8");
  const y = Buffer.from(b.toLowerCase(), "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}
