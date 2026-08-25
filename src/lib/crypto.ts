import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

/**
 * Authenticated encryption for anything we hand back to the browser.
 *
 * Format:  v1.<iv>.<ciphertext>.<authTag>   (each part base64url)
 *
 * AES-256-GCM gives confidentiality *and* integrity, so a tampered cookie
 * fails to decrypt rather than silently deserialising into attacker-chosen
 * state. The version prefix lets us rotate the scheme without ambiguity.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const VERSION = "v1";

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (!cachedKey) cachedKey = Buffer.from(env.SESSION_SECRET, "base64url");
  return cachedKey;
}

/** Encrypt an arbitrary JSON-serialisable value into an opaque token. */
export function seal(payload: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a token produced by `seal`.
 * Returns `null` for anything malformed, tampered with, or of a stale version —
 * callers treat that identically to "no session".
 */
export function unseal<T = unknown>(token: string | undefined): T | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [version, ivB64, dataB64, tagB64] = parts as [
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION) return null;

  try {
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv(ALGO, key(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    // Bad tag, bad key, bad JSON — all indistinguishable to the caller.
    return null;
  }
}

/** Constant-time string comparison for CSRF tokens and OAuth verifiers. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length mismatch is not measurably faster.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** URL-safe random token, e.g. for CSRF state. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
