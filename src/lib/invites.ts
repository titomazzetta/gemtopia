import "server-only";
import { env } from "./env";
import { hashInviteCode, inviteKey, normaliseInviteCode } from "./invite-code";

/**
 * Invite codes: the half that needs the server secret and the environment.
 * Everything testable without them is in `invite-code.ts`.
 */

let cachedKey: Buffer | null = null;

/**
 * What a person typed → the hash it would be stored under, or null if it
 * cannot be a code at all. The plaintext goes no further than this function.
 */
export function inviteHash(input: unknown): string | null {
  const code = normaliseInviteCode(input);
  if (!code) return null;
  cachedKey ??= inviteKey(env.SESSION_SECRET);
  return hashInviteCode(code, cachedKey);
}

/** Admins are named in ADMIN_USERNAMES; the name comes from the session Discogs asserted. */
export function isAdmin(username: string): boolean {
  return env.ADMIN_USERNAMES.includes(username.toLowerCase());
}

export const INVITE_ONLY = env.INVITE_ONLY;
export const ADMIN_KEYS: readonly string[] = env.ADMIN_USERNAMES;
