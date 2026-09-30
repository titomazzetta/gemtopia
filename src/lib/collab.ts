import { createHash } from "node:crypto";

/**
 * Collaborative playlists: the pure rules.
 *
 * Everything here is free of the database and the environment, so each rule
 * is tested directly (scripts/test-collab.mjs). The SQL that enforces them
 * lives in repo.ts; the routes are thin.
 */

/** Anyone past this is an abuse case, not a back-to-back set. */
export const MAX_COLLABORATORS = 50;

/** 32 random bytes, base64url — the same shape as a share token. */
const JOIN_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function isJoinToken(value: unknown): value is string {
  return typeof value === "string" && JOIN_TOKEN.test(value);
}

/**
 * The only form a join link is stored in.
 *
 * A plain SHA-256 is enough here, unlike the invite codes' keyed HMAC: the
 * token is 256 bits of randomness, so there is nothing to brute-force from
 * the hash. What hashing buys is that a database dump contains no working
 * links — every collaborative playlist would otherwise be one SELECT away
 * from being joined by whoever holds the dump.
 */
export function hashJoinToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Where sign-in may send someone afterwards. Exactly one shape is allowed:
 * a join link on this site. Anything else — another path, another host, a
 * protocol-relative `//evil.example`, a backslash trick — is null, and the
 * callback falls back to "/". An allow-list of one is the whole defence
 * against sign-in becoming an open redirect.
 */
export function safeNextPath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = /^\/join\/([A-Za-z0-9_-]{43})$/.exec(input);
  return match ? `/join/${match[1]}` : null;
}

export type CollabRole = "owner" | "editor";

export type PlaylistAction =
  | "edit-items"
  | "rename"
  | "delete"
  | "share-link"
  | "manage-join-link"
  | "remove-member"
  | "leave";

/**
 * Who may do what. Editors change what's in the set and its order, and can
 * leave. Everything that changes what the playlist *is* — its name, its
 * existence, who can see or join it — stays with the owner.
 */
export function can(role: CollabRole, action: PlaylistAction): boolean {
  if (role === "owner") return action !== "leave";
  return action === "edit-items" || action === "leave";
}

/**
 * Who added each record, carried across an edit.
 *
 * Edits replace the whole list, so without this every save would re-credit
 * every record to whoever saved last. Records already present keep their
 * credit — matched in order, so a record in the list twice keeps both — and
 * only records that are new in this edit are credited to the person making it.
 */
export function carryAddedBy(
  previous: ReadonlyArray<{ clipKey: string; addedBy: string | null }>,
  next: ReadonlyArray<string>,
  actorId: string,
): Array<string | null> {
  const pool = new Map<string, Array<string | null>>();
  for (const row of previous) {
    const list = pool.get(row.clipKey) ?? [];
    list.push(row.addedBy);
    pool.set(row.clipKey, list);
  }
  return next.map((key) => {
    const list = pool.get(key);
    if (list && list.length > 0) return list.shift() ?? null;
    return actorId;
  });
}
