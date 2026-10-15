/**
 * The playlist file: export one playlist or all of them, and import either.
 *
 * One format for both, so a file holding one set imports exactly like a
 * backup of twenty:
 *
 *   { app: "gemtopia", version: 2, exportedAt, playlists: [{ name, entries }] }
 *
 * An entry is the stored row minus its position (order is array order) and
 * minus anything about people. A file you hand to someone carries the
 * records, not who added them or whose BPM readings the set holds.
 *
 * Reading treats the file as hostile. This module only checks the outline
 * and trims names; what a valid entry is gets decided by the server's strict
 * Zod schema (importPlaylistsSchema), which rejects the whole file on one bad
 * entry rather than importing half of it.
 */

import type { Playlist, PlaylistItemRow } from "@/lib/types";
import { PLAYLIST_NAME_MAX } from "@/lib/playlistCopy";

export type FileEntry = Pick<
  PlaylistItemRow,
  "clipKey" | "releaseId" | "videoId" | "title" | "artist" | "releaseTitle" | "year"
>;

export interface FilePlaylist {
  name: string;
  entries: FileEntry[];
}

export const PLAYLIST_FILE_VERSION = 2;

/** A real export of 200 playlists is well under this; anything bigger is not one. */
export const PLAYLIST_FILE_MAX_BYTES = 5_000_000;

export function fileEntry(row: PlaylistItemRow | FileEntry): FileEntry {
  return {
    clipKey: row.clipKey,
    releaseId: row.releaseId,
    videoId: row.videoId,
    title: row.title,
    artist: row.artist,
    releaseTitle: row.releaseTitle,
    year: row.year,
  };
}

/** "B2B at the Lot!" → "b2b-at-the-lot". Never empty. */
export function fileSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "playlist";
}

/**
 * The file for these playlists: one named after the playlist when there's
 * one, `gemtopia-playlists-<date>` for a backup of all of them.
 */
export function playlistFile(
  playlists: readonly Pick<Playlist, "name" | "entries">[],
  { all = playlists.length !== 1, now = new Date() }: { all?: boolean; now?: Date } = {},
): { filename: string; json: string } {
  const date = now.toISOString().slice(0, 10);
  const payload = {
    app: "gemtopia",
    version: PLAYLIST_FILE_VERSION,
    exportedAt: now.toISOString(),
    playlists: playlists.map((p) => ({ name: p.name, entries: p.entries.map(fileEntry) })),
  };
  const filename =
    all || playlists.length !== 1
      ? `gemtopia-playlists-${date}.json`
      : `gemtopia-${fileSlug(playlists[0]!.name)}-${date}.json`;
  return { filename, json: JSON.stringify(payload, null, 2) };
}

/**
 * The playlists in a file someone chose, or null when it isn't one of ours.
 *
 * Accepts any export this app has written (one playlist or many). Names are
 * trimmed and capped, nameless playlists are dropped, and entries are passed
 * through as-is for the server to judge.
 */
export function readPlaylistFile(raw: unknown): FilePlaylist[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const lists = (raw as { playlists?: unknown }).playlists;
  if (!Array.isArray(lists)) return null;

  const out: FilePlaylist[] = [];
  for (const list of lists) {
    if (typeof list !== "object" || list === null) continue;
    const { name, entries } = list as { name?: unknown; entries?: unknown };
    if (typeof name !== "string") continue;
    const trimmed = name.trim().slice(0, PLAYLIST_NAME_MAX).trim();
    if (!trimmed) continue;
    out.push({ name: trimmed, entries: Array.isArray(entries) ? (entries as FileEntry[]) : [] });
  }
  return out.length > 0 ? out : null;
}
