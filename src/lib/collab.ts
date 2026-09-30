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
  | "remove-any-record"
  | "chat"
  | "delete-any-message"
  | "rename"
  | "delete"
  | "share-link"
  | "manage-join-link"
  | "remove-member"
  | "leave";

/**
 * Who may do what. Editors add records, reorder them, take out the ones
 * they added themselves (removalsNotAllowed), chat, and can leave.
 * Everything that changes what the playlist *is* — its name, its existence,
 * who can see or join it — stays with the owner, and so does taking out
 * anyone else's records or messages.
 */
export function can(role: CollabRole, action: PlaylistAction): boolean {
  if (role === "owner") return action !== "leave";
  return action === "edit-items" || action === "chat" || action === "leave";
}

type Credited = ReadonlyArray<{ clipKey: string; addedBy: string | null }>;

/** Each record's credits, by clip key, in list order. */
function creditsByKey(previous: Credited): Map<string, Array<string | null>> {
  const pool = new Map<string, Array<string | null>>();
  for (const row of previous) {
    const list = pool.get(row.clipKey) ?? [];
    list.push(row.addedBy);
    pool.set(row.clipKey, list);
  }
  return pool;
}

function countKeys(keys: ReadonlyArray<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

/**
 * How many records this edit takes out that the person making it may not.
 *
 * The rule for a shared set: anyone on it can add and reorder, but taking a
 * record *out* is the owner's call — except for records you put in yourself.
 * Records from before anyone was credited (`addedBy` null) count as the
 * owner's.
 *
 * Edits arrive as the whole list, so "what was removed" is worked out here
 * as a count per record, not trusted from the client: for each clip key, the
 * copies that were there minus the copies that are left. A collaborator's
 * removals of a key must be covered by copies they added. 0 means the edit
 * may go through; anything else is refused as a whole.
 */
export function removalsNotAllowed(
  previous: Credited,
  next: ReadonlyArray<string>,
  actorId: string,
  isOwner: boolean,
): number {
  if (isOwner) return 0;
  const pool = creditsByKey(previous);
  const left = countKeys(next);
  let refused = 0;
  for (const [key, credits] of pool) {
    const removed = credits.length - (left.get(key) ?? 0);
    if (removed <= 0) continue;
    const theirs = credits.filter((id) => id === actorId).length;
    refused += Math.max(0, removed - theirs);
  }
  return refused;
}

/**
 * Who added each record, carried across an edit.
 *
 * Edits replace the whole list, so without this every save would re-credit
 * every record to whoever saved last. Records already present keep their
 * credit — matched in order, so a record in the list twice keeps both — and
 * only records that are new in this edit are credited to the person making it.
 *
 * When a record in the list more than once loses a copy, the copy that goes
 * is one the person editing added, if they added one. That is what
 * removalsNotAllowed allowed, so it is what is removed: a collaborator taking
 * out their own duplicate never strips someone else's credit.
 */
export function carryAddedBy(
  previous: Credited,
  next: ReadonlyArray<string>,
  actorId: string,
): Array<string | null> {
  const pool = creditsByKey(previous);
  const left = countKeys(next);
  for (const [key, credits] of pool) {
    let excess = credits.length - (left.get(key) ?? 0);
    for (let i = credits.length - 1; i >= 0 && excess > 0; i -= 1) {
      if (credits[i] === actorId) {
        credits.splice(i, 1);
        excess -= 1;
      }
    }
    if (excess > 0) credits.splice(credits.length - excess, excess);
  }
  return next.map((key) => {
    const list = pool.get(key);
    if (list && list.length > 0) return list.shift() ?? null;
    return actorId;
  });
}
