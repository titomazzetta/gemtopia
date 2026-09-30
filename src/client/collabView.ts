/**
 * How a collaborative playlist presents itself. Pure, so it is tested.
 */

import type { Playlist } from "@/lib/types";

type CollabFields = Pick<Playlist, "role" | "collaborators" | "joinLinkOn">;

/**
 * A playlist is shown as collaborative — amber border, people icon — the
 * moment it is open to anyone else: you joined someone's, someone joined
 * yours, or you have a join link out. The last one matters: a link you've
 * sent is an open door, and the list should say so before anyone walks in.
 */
export function isCollabPlaylist(p: CollabFields): boolean {
  return p.role === "editor" || p.collaborators.length > 0 || p.joinLinkOn;
}

/** The line under a playlist's name. */
export function collabLine(p: CollabFields & Pick<Playlist, "owner">, me: string): string | null {
  if (!isCollabPlaylist(p)) return null;
  const others = [p.role === "editor" ? p.owner : null, ...p.collaborators]
    .filter((name): name is string => Boolean(name))
    .filter((name) => name.toLowerCase() !== me.toLowerCase());
  if (others.length === 0) return "Collab · link out, nobody's joined yet";
  const shown = others.slice(0, 2).join(", ");
  const more = others.length > 2 ? ` +${others.length - 2}` : "";
  return `Collab with ${shown}${more}`;
}

/**
 * Whether to offer "remove" on a record. The owner can take out anything; a
 * collaborator only what they added. The server enforces the same rule
 * (collab.removalsNotAllowed) — this just avoids offering a button that
 * would be refused.
 */
export function canRemoveEntry(
  role: Playlist["role"],
  addedBy: string | null | undefined,
  me: string,
): boolean {
  if (role === "owner") return true;
  return typeof addedBy === "string" && addedBy.toLowerCase() === me.toLowerCase();
}
