/**
 * Who may do what on a shared playlist. Pure and free of Node, so the server
 * (repo.ts, the routes) and the browser (what to offer) read the same table;
 * scripts/test-collab.mjs pins it.
 */

/**
 * What someone on a shared set may do, set by its owner, one person at a
 * time (repo.setMemberRole). Stored in playlist_members.role.
 *
 * - "viewer": listen and chat. Sees the set as it is built; changes nothing.
 * - "editor": the default for anyone who joins with the link. Adds records,
 *   reorders, takes out the ones they added, chats.
 * - "full": full control of what's in the set. Everything an editor can,
 *   plus taking out anyone's records and renaming it.
 *
 * Whatever the level, what the set *is* stays with the owner: deleting it,
 * the public share link, the join link, who's on it and what each can do.
 */
export const MEMBER_ROLES = ["viewer", "editor", "full"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** What joining with the link gives you. */
export const DEFAULT_MEMBER_ROLE: MemberRole = "editor";

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Each level by how much it allows, lowest first. */
const RANK: Record<MemberRole, number> = { viewer: 0, editor: 1, full: 2 };

/**
 * The level to keep for someone who leaves or is taken off a set, so that
 * coming back through the join link gives them it again — or null for
 * "nothing to keep".
 *
 * Only a level *below* what joining gives is kept. A restriction outlives
 * leaving, or leaving and rejoining would be a way round it. A grant does
 * not: full control is the owner's trust in someone while they're on the
 * set, and someone taken off it — perhaps for misusing it — must not get it
 * back by opening a link that is still live. They come back at the default,
 * and the owner can give it again.
 */
export function levelToRemember(role: MemberRole): MemberRole | null {
  return RANK[role] < RANK[DEFAULT_MEMBER_ROLE] ? role : null;
}

export type CollabRole = "owner" | MemberRole;

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
  | "set-roles"
  | "leave";

/** Who may do what. The SQL in repo.ts enforces the same table; this is it in one place, tested. */
export function can(role: CollabRole, action: PlaylistAction): boolean {
  switch (role) {
    case "owner":
      return action !== "leave";
    case "full":
      return (
        action === "edit-items" ||
        action === "remove-any-record" ||
        action === "rename" ||
        action === "chat" ||
        action === "leave"
      );
    case "editor":
      return action === "edit-items" || action === "chat" || action === "leave";
    case "viewer":
      return action === "chat" || action === "leave";
    default:
      return false;
  }
}
