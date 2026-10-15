/**
 * Naming a duplicated playlist.
 *
 * "B2B at the Lot" copies as "B2B at the Lot (copy)", then "(copy 2)", and
 * so on, skipping any name already in your list — so three copies of the
 * same set are three rows you can tell apart. Copying a copy counts from the
 * original name rather than stacking: "Set (copy 2)" copies as "Set (copy 3)",
 * never "Set (copy 2) (copy)".
 *
 * Pure, and shared by the server (which names the copy) and the tests.
 */

/** The same cap as createPlaylistSchema's name. */
export const PLAYLIST_NAME_MAX = 80;

const COPY_SUFFIX = /\s*\(copy(?: \d+)?\)$/i;

export function copyName(name: string, taken: Iterable<string> = []): string {
  const names = new Set([...taken].map((n) => n.trim().toLocaleLowerCase()));
  const base = name.trim().replace(COPY_SUFFIX, "").trim() || name.trim() || "Playlist";

  for (let n = 1; n <= 999; n += 1) {
    const suffix = n === 1 ? " (copy)" : ` (copy ${n})`;
    // Long names lose letters, never the suffix: the suffix is what says
    // which one this is.
    const candidate = base.slice(0, PLAYLIST_NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  // Nine hundred and ninety-nine copies of one set: names may repeat now.
  return base.slice(0, PLAYLIST_NAME_MAX - 7).trimEnd() + " (copy)";
}
