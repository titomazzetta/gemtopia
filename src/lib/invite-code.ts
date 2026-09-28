import { createHmac, randomBytes } from "node:crypto";

/**
 * Invite codes: the pure half.
 *
 * Nothing here touches the database or the environment, so all of it is
 * tested directly (scripts/test-invites.mjs). The route handlers and repo
 * functions that use it live in `repo.ts` and `api/admin/*`.
 *
 * The shape is `XXXX-XXXX`: eight characters from a 31-letter alphabet with
 * the look-alikes removed (no 0/O, 1/I/L), so a code read aloud or retyped
 * from a DM survives. That is 31^8 ≈ 8.5 × 10^11 codes, about 39.6 bits.
 * On its own that would be thin; it is enough here because every code is
 * single-use, lives an hour or a day, is checked behind a rate limit, and only
 * a handful exist at once (see MAX_LIVE_INVITES). An online guesser gets tens
 * of tries per window against a space of hundreds of billions.
 */

export const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_LENGTH = 8;

/** How long a code can be asked to live, in hours. Nothing else is accepted. */
export const INVITE_LIFETIMES = [1, 24] as const;
export type InviteLifetime = (typeof INVITE_LIFETIMES)[number];

/** Unused, unexpired codes one admin may hold at once. */
export const MAX_LIVE_INVITES = 20;

/**
 * A fresh code, uniformly distributed over the alphabet.
 *
 * `byte % 31` alone would be biased: 256 is not a multiple of 31, so the first
 * nine letters would turn up slightly more often. Bytes at or above 248
 * (8 × 31) are thrown away and redrawn instead — rejection sampling, the
 * standard fix. `random` is injectable only so the test can prove the
 * rejection branch runs.
 */
export function generateInviteCode(
  random: (size: number) => Uint8Array = randomBytes,
): string {
  const limit = Math.floor(256 / INVITE_ALPHABET.length) * INVITE_ALPHABET.length;
  let out = "";
  while (out.length < INVITE_LENGTH) {
    for (const byte of random(INVITE_LENGTH * 2)) {
      if (byte >= limit) continue;
      out += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
      if (out.length === INVITE_LENGTH) break;
    }
  }
  return formatInviteCode(out);
}

/** `ABCDEFGH` → `ABCD-EFGH`. */
export function formatInviteCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * What a person typed, reduced to the eight characters that matter — or
 * `null` if it cannot be a code.
 *
 * Forgiving about what people actually do (lower case, spaces, a missing or
 * extra dash) and strict about everything else. The alphabet has no O, 0, I,
 * 1 or L at all, so there is no look-alike to guess at: a code containing one
 * was mistyped, and is refused before it goes near the database.
 */
export function normaliseInviteCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 32) return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, "");
  if (cleaned.length !== INVITE_LENGTH) return null;
  for (const ch of cleaned) {
    if (!INVITE_ALPHABET.includes(ch)) return null;
  }
  return cleaned;
}

/**
 * The only form a code is ever stored in.
 *
 * HMAC-SHA256 under a key derived from SESSION_SECRET, never the code itself.
 * A copy of the database is then no use for getting in: turning a hash back
 * into a live code means knowing the server secret, and a leaked code list is
 * exactly the kind of thing a leaked database would otherwise hand over.
 *
 * The key is derived (HMAC of a fixed label) rather than being SESSION_SECRET
 * itself, so the cookie-sealing key is never used for a second purpose.
 * Rotating SESSION_SECRET therefore also voids every outstanding code — which
 * is what you want from the emergency lever, and harmless, since none of them
 * lives longer than a day.
 */
export function inviteKey(sessionSecret: string): Buffer {
  return createHmac("sha256", Buffer.from(sessionSecret, "base64url"))
    .update("gemtopia:invite-code:v1")
    .digest();
}

export function hashInviteCode(normalised: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalised).digest("hex");
}

/** Accept only the lifetimes the UI offers; anything else is not a request we make. */
export function parseLifetime(value: unknown): InviteLifetime | null {
  return INVITE_LIFETIMES.find((hours) => hours === value) ?? null;
}

/* ------------------------------------------------------------------ */
/* Who gets in                                                         */
/* ------------------------------------------------------------------ */

export type Admission =
  /** Sign in as normal. */
  | "enter"
  /** Spend the invite code; sign in only if that succeeds. */
  | "redeem"
  /** New here, invite-only is on, and no code came with them. */
  | "not_invited"
  /** An admin removed this account, and no code came with them. */
  | "removed";

/**
 * The whole sign-up policy, as one pure function the callback obeys.
 *
 * Kept apart from the route so every branch is tested and the order of the
 * checks is written down in one place:
 *
 *   1. Admins always get in (and cannot be removed — see repo.removeMember).
 *   2. An existing member gets in. A code they happen to carry is *not*
 *      spent, so it is still good for whoever it was really meant for.
 *   3. A removed member gets back in only by spending a fresh code.
 *   4. Someone new gets in freely while invite-only is off,
 *   5. …and by spending a code while it is on.
 */
export function admit(input: {
  member: { revoked: boolean } | null;
  isAdmin: boolean;
  inviteOnly: boolean;
  hasCode: boolean;
}): Admission {
  const { member, isAdmin, inviteOnly, hasCode } = input;
  if (isAdmin) return "enter";
  if (member && !member.revoked) return "enter";
  if (member?.revoked) return hasCode ? "redeem" : "removed";
  if (!inviteOnly) return "enter";
  return hasCode ? "redeem" : "not_invited";
}

/** How a code reads in the admin list. */
export type InviteStatus = "live" | "used" | "expired" | "revoked";

export function inviteStatus(
  row: { usedAt: number | null; revokedAt: number | null; expiresAt: number },
  now: number,
): InviteStatus {
  if (row.usedAt !== null) return "used";
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt <= now) return "expired";
  return "live";
}
