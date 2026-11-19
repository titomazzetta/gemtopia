/**
 * Discogs collection folders, on the records.
 *
 * Most DJs who use Discogs have already sorted their shelf there — a "DJ"
 * folder, a "Listening" folder, "Sell", "Mum's" — and a shuffle of the whole
 * collection that keeps serving the listening albums was the first thing a
 * friend asked to turn off. The folder each copy sits in comes with the
 * collection listing (lib/discogs.ts); the folder names come from one more
 * request (/api/discogs/folders). This joins the two onto the rows, the way
 * BPMs and tags are joined, so the Folder filter and its chips can work in
 * names.
 *
 * Not known is not "none": a want has no folder, and a record listed before
 * folders were read has none recorded yet. Both are left undefined, and the
 * filter lets undefined through, so turning on "only DJ" on a half-read crate
 * hides nothing it shouldn't.
 */

import type { CollectionFolder, Playable } from "@/lib/types";

/** Folder 0 is "All" — every record is in it, so it is not a choice. */
export function choosableFolders(folders: readonly CollectionFolder[]): CollectionFolder[] {
  return folders.filter((f) => f.id > 0);
}

/**
 * A collection lists copies, not records: two copies of one record — a
 * double in the DJ folder, a spare in Sell — are two rows, on the same page
 * of the listing or on different ones. The listing route sends each row with
 * its own copy's folder (lib/discogs.ts); this joins the copies of a record
 * across one whole listing run, so what is stored is every folder a copy
 * sits in rather than whichever row came last.
 *
 * `seen` is the run's memory and is updated in place: a later row for the
 * same record comes back carrying the earlier rows' folders too, and it is
 * the later row that the store keeps. An item with no folder ids (a want) is
 * passed through untouched.
 */
export function mergeFolderIds<T extends { id: number; folderIds?: number[] }>(
  items: readonly T[],
  seen: Map<number, number[]>,
): T[] {
  return items.map((item) => {
    if (!Array.isArray(item.folderIds)) return item;
    const before = seen.get(item.id);
    if (!before) {
      seen.set(item.id, item.folderIds);
      return item;
    }
    const merged = [...new Set([...before, ...item.folderIds])];
    seen.set(item.id, merged);
    return { ...item, folderIds: merged };
  });
}

/**
 * Whether a cached listing predates folders: there are records, and none of
 * them says which folder it is in. One cheap re-listing fixes that — the
 * listing only, no tracklists — so the Folder filter is there on the first
 * visit after it shipped rather than whenever the next sync happens to be
 * due. A listing read by this version always carries the field, even when
 * empty, so this is true once per device at most.
 */
export function listedBeforeFolders(summaries: ReadonlyArray<{ folderIds?: number[] }>): boolean {
  return summaries.length > 0 && !summaries.some((s) => Array.isArray(s.folderIds));
}

/**
 * The selected folder names that still exist. A folder renamed or removed on
 * Discogs leaves its old name in the standing choice (folderPreference.ts),
 * where it would select nothing anyone can see — an empty crate with no chip
 * lit. With the fresh list in hand those names are dropped. An empty list is
 * "not read", not "no folders": nothing is dropped on it.
 */
export function knownFolders(
  selected: readonly string[],
  folders: readonly CollectionFolder[],
): string[] {
  if (folders.length === 0) return [...selected];
  const names = new Set(choosableFolders(folders).map((f) => f.name));
  return selected.filter((name) => names.has(name));
}

/** The names for a record's folder ids, or undefined when nothing can be said. */
export function folderNamesFor(
  ids: readonly number[] | undefined,
  folders: readonly CollectionFolder[],
): readonly string[] | undefined {
  if (!ids || ids.length === 0 || folders.length === 0) return undefined;
  const byId = new Map(folders.map((f) => [f.id, f.name] as const));
  const names = [...new Set(ids.map((id) => byId.get(id)).filter((n): n is string => typeof n === "string" && n !== ""))];
  return names.length > 0 ? names : undefined;
}

/** Every row with its folder names on it, where they are known. */
export function withFolders(
  items: Playable[],
  folderIds: ReadonlyMap<number, readonly number[]>,
  folders: readonly CollectionFolder[],
): Playable[] {
  if (folderIds.size === 0 || folders.length === 0) return items;
  const cache = new Map<number, readonly string[] | undefined>();
  return items.map((item) => {
    if (!cache.has(item.releaseId)) cache.set(item.releaseId, folderNamesFor(folderIds.get(item.releaseId), folders));
    const names = cache.get(item.releaseId);
    return names ? { ...item, folders: names } : item;
  });
}

/**
 * Whether a row passes the Folder filter. With nothing selected everything
 * does, and a row whose folders aren't known passes either way.
 *
 * "Only" keeps a record with a copy in any selected folder. "Hide" drops a
 * record when every copy of it sits in a hidden folder — so a double with
 * one copy in DJ and a spare in Sell is still there after hiding Sell, which
 * is what hiding a shelf means: what's left is what's on the others. It also
 * keeps the two modes in step: a record "only DJ" shows is never one that
 * "hide Listening" takes away.
 */
export function inFolders(
  item: Pick<Playable, "folders">,
  selected: ReadonlySet<string>,
  hide: boolean,
): boolean {
  if (selected.size === 0 || item.folders === undefined || item.folders.length === 0) return true;
  if (hide) return item.folders.some((name) => !selected.has(name));
  return item.folders.some((name) => selected.has(name));
}
