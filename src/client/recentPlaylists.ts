/**
 * Which playlist you probably mean.
 *
 * Building a set is repetitive: you hear four records that belong together and
 * add them one after another to the same list. Alphabetical order ignores that
 * entirely and makes you re-find the same playlist four times. Most-recently-
 * added-to puts it under your thumb.
 *
 * Deliberately session-scoped and in memory. "The list I was just adding to"
 * is a fact about the last ten minutes, not a preference — persisting it would
 * mean a playlist you touched once last month outranks the one you made this
 * morning, which is the opposite of the intent.
 */

/**
 * Move an id to the front, keeping the rest in order and never duplicating.
 *
 * Pure and returning a new array, because this feeds React state: mutating the
 * existing one would keep the same reference and the picker would not re-order
 * until something else forced a render.
 */
export function promote(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((existing) => existing !== id)];
}

/**
 * Playlists in the order to offer them: recently used first, then whatever
 * order they arrived in.
 *
 * Ids in `recent` that no longer match a playlist are ignored rather than
 * treated as missing — a list can be deleted from another device between one
 * add and the next, and a picker that renders a hole is worse than one that
 * quietly forgets.
 */
export function orderByRecent<T extends { id: string }>(
  playlists: readonly T[],
  recent: readonly string[],
): T[] {
  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const promoted: T[] = [];

  for (const id of recent) {
    const playlist = byId.get(id);
    if (playlist) {
      promoted.push(playlist);
      byId.delete(id);
    }
  }

  // Map preserves insertion order, so the remainder keeps the order it came in.
  return [...promoted, ...byId.values()];
}
