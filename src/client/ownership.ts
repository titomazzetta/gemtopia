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

/**
 * The wantlist heart on the player: whether to show it, and filled or not.
 *
 * Shown for anything you are not known to own — a dig preview, a Discogs
 * search preview, a friend's record on a shared playlist, a record you are
 * playing from your own wantlist. That is the moment the heart is for: a
 * track grabs you, it isn't yours, one tap and it's on the list.
 *
 * Hidden only when the collection index *says* you own it. An unsynced index
 * (`null`) still shows the heart, the opposite way round from the labels
 * above, because the cost of the two mistakes is the opposite way round too:
 * a heart on a record you own adds a want you can take off again with the
 * same tap, while no heart on a record you don't own is exactly the bug this
 * exists to fix.
 */
export function wantlistHeart(state: OwnershipState): { wanted: boolean } | null {
  if (state.inCollection === true) return null;
  return { wanted: state.onWantlist === true };
}

/** Where a search result sits: what you own, what you want, everything else. */
export type SearchGroup = "collection" | "wantlist" | "discogs";

export const SEARCH_GROUP_LABELS: Record<SearchGroup, string> = {
  collection: "In your collection",
  wantlist: "On your wantlist",
  discogs: "Everything else on Discogs",
};

const GROUP_RANK: Record<SearchGroup, number> = { collection: 0, wantlist: 1, discogs: 2 };

/**
 * Search results with what you have first: your collection, then your
 * wantlist, then the rest — each group in the order Discogs ranked it.
 *
 * A search for an artist or a catalogue number usually turns up the pressing
 * on your shelf among a dozen that aren't, and it's the one you were after:
 * it should be the first row, not the ninth. Same for a want — searching it
 * is usually "is that the one I've been looking for".
 *
 * Grouped on what is known only, like every other ownership answer here: an
 * unsynced list moves nothing up, and owning beats wanting when a record is
 * on both (Discogs never drops a want when you add the release). Callers
 * group once, when results land, so a record you add from the list doesn't
 * jump away from under the pointer.
 */
export function groupBySet<T extends { id: number }>(
  hits: readonly T[],
  sets: { collection: Set<number>; wantlist: Set<number> },
): Array<{ hit: T; group: SearchGroup }> {
  return hits
    .map((hit, index) => {
      const state = ownershipFrom(sets, hit.id);
      const group: SearchGroup =
        state.inCollection === true ? "collection" : state.onWantlist === true ? "wantlist" : "discogs";
      return { hit, group, index };
    })
    .sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.index - b.index)
    .map(({ hit, group }) => ({ hit, group }));
}
