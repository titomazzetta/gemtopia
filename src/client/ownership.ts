/**
 * "Do I already own this?" — answered honestly.
 *
 * The check runs against the IndexedDB collection index, so it is instant,
 * costs no Discogs request, and works in a basement record shop with no
 * signal. That is the whole point: the moment you need this answer is the
 * moment you are holding a record and deciding whether to buy it.
 *
 * The constraint that shapes the whole module: **absence is never reported.**
 * The index is only as fresh as the last sync, and the wantlist is only in it
 * if that source has ever been synced. So a row can say "In your collection"
 * or "On your wantlist" or stay silent — but it must never say "you do not own
 * this", because we cannot know that, and a confident wrong answer is how
 * somebody buys a second copy of a record they already have.
 */

export interface OwnershipState {
  /** true present, false absent from a synced index, null never synced. */
  inCollection: boolean | null;
  onWantlist: boolean | null;
}

/**
 * What to show on a result row, or null for nothing at all.
 *
 * Collection beats wantlist when both are true: owning it is the fact that
 * changes what you do next, and a record can legitimately be on both lists
 * because Discogs never removes a want when you add the release.
 */
export function describeOwnership(state: OwnershipState): string | null {
  if (state.inCollection === true) return "In your collection";
  if (state.onWantlist === true) return "On your wantlist";
  return null;
}

/**
 * Ownership from the id sets CrateApp already keeps in memory.
 *
 * An empty set is treated as "unknown", not "empty". It genuinely could be
 * either — a wantlist that has never been synced and a wantlist with nothing
 * on it look identical from here — and the two possible mistakes are not
 * symmetrical. Reporting unknown when the list is really empty costs a label
 * nobody misses. Reporting empty when it was really unsynced tells someone
 * they do not own a record they own.
 */
export function ownershipFrom(
  sets: { collection: Set<number>; wantlist: Set<number> },
  releaseId: number,
): OwnershipState {
  return {
    inCollection: sets.collection.size > 0 ? sets.collection.has(releaseId) : null,
    onWantlist: sets.wantlist.size > 0 ? sets.wantlist.has(releaseId) : null,
  };
}

/** Whether adding to the collection would be a no-op worth warning about. */
export function alreadyCollected(state: OwnershipState): boolean {
  return state.inCollection === true;
}

/**
 * What a search row shows once you have pressed something on it.
 *
 * These two facts fight. The id sets gain the release the instant the add
 * returns, so `describeOwnership` starts saying "In your collection" at the
 * same moment the row wants to say "Added to your collection" — and both
 * rendering is how a row ends up with two badges making one point.
 *
 * The action wins. "In your collection" is a state you may have been in for
 * years; "Added to your collection" says the button you just pressed did what
 * it said. The second answers the question you actually have.
 */
export type RowAction = "idle" | "working" | "collected" | "wanted" | "failed";

export function badgeFor(
  state: OwnershipState,
  action: RowAction,
): string | null {
  if (action === "collected") return "Added to your collection";
  if (action === "wanted") return "Added to your wantlist";
  return describeOwnership(state);
}

/**
 * What to ask before putting a record in someone's collection.
 *
 * There is a confirmation at all because **this app cannot undo one.** There
 * is no remove-from-collection anywhere in the codebase, deliberately, so a
 * mis-tap on a phone can only be fixed by opening Discogs. A confirmation is
 * not friction here; it is the only safety net that exists.
 *
 * The second copy case is real rather than defensive. Discogs models a
 * collection as instances, so owning two pressings of the same record is
 * ordinary — but it is almost never what someone meant when they pressed add
 * on a search result, and silently making it happen is how a collection
 * quietly gains duplicates nobody notices for a year.
 *
 * Absence is still never claimed. An unsynced index gives `null`, and the
 * question falls back to the neutral wording rather than asserting you don't
 * already have it.
 */
export function confirmAddMessage(state: OwnershipState): string {
  return state.inCollection === true
    ? "You already have this. Add a second copy?"
    : "Add this to your collection?";
}
