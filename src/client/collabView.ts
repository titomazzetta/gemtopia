/**
 * How a collaborative playlist presents itself. Pure, so it is tested.
 */

import type { Playlist } from "@/lib/types";
import { can, type MemberRole } from "@/lib/roles";

type CollabFields = Pick<Playlist, "role" | "collaborators" | "joinLinkOn">;

/**
 * A playlist is shown as collaborative — amber border, people icon — the
 * moment it is open to anyone else: you joined someone's, someone joined
 * yours, or you have a join link out. The last one matters: a link you've
 * sent is an open door, and the list should say so before anyone walks in.
 */
export function isCollabPlaylist(p: CollabFields): boolean {
  return p.role !== "owner" || p.collaborators.length > 0 || p.joinLinkOn;
}

/** The line under a playlist's name. */
export function collabLine(p: CollabFields & Pick<Playlist, "owner">, me: string): string | null {
  if (!isCollabPlaylist(p)) return null;
  const others = [p.role !== "owner" ? p.owner : null, ...p.collaborators]
    .filter((name): name is string => Boolean(name))
    .filter((name) => name.toLowerCase() !== me.toLowerCase());
  if (others.length === 0) return "Collab · link out, nobody's joined yet";
  const shown = others.slice(0, 2).join(", ");
  const more = others.length > 2 ? ` +${others.length - 2}` : "";
  return `Collab with ${shown}${more}`;
}

/**
 * Whether to offer "remove" on a record. The owner, and anyone they've given
 * full control, can take out anything; an editor only what they added; a
 * listener nothing. The server enforces the same rule (repo.replaceItems,
 * collab.removalsNotAllowed) — this just avoids offering a button that would
 * be refused.
 */
export function canRemoveEntry(
  role: Playlist["role"],
  addedBy: string | null | undefined,
  me: string,
): boolean {
  if (can(role, "remove-any-record")) return true;
  if (!can(role, "edit-items")) return false;
  return typeof addedBy === "string" && addedBy.toLowerCase() === me.toLowerCase();
}

/** Whether you can change what's in this set at all: add, move, take out. */
export function canEditSet(role: Playlist["role"]): boolean {
  return can(role, "edit-items");
}

/** Whether you can rename it: the owner, and full control. */
export function canRenameSet(role: Playlist["role"]): boolean {
  return can(role, "rename");
}

/** Each level, as the people panel and the chat name it. */
export const ROLE_LABEL: Record<MemberRole, { name: string; says: string }> = {
  viewer: { name: "Listen", says: "Plays the set and chats. Can't change it." },
  editor: { name: "Add", says: "Adds records, reorders, takes out their own." },
  full: { name: "Full control", says: "Takes out anyone's records, and can rename it." },
};
