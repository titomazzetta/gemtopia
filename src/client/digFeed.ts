/**
 * Keeping a dig moving.
 *
 * A lane that simply stops is a dead end, and digging is supposed to be the
 * opposite of that: every record leads somewhere. Two rules here:
 *
 *   - In your crate, everything is already on the device, so a lane shows a
 *     handful and reveals more as you reach its end, until it has shown every
 *     record you own that fits. Then it points you beyond the crate.
 *   - Beyond your crate, reaching the end asks Discogs for the next page of
 *     the same lookups and appends it. Lanes keep their place; nothing you
 *     were looking at jumps. When Discogs has nothing further, the lane says
 *     so and points at the per-record dig button, which starts a new corner.
 */

/** How many records a crate lane shows before you ask for more. */
export const LOCAL_FIRST = 16;
/** How many more each "More" reveals. */
export const LOCAL_STEP = 24;
/** The highest upstream page "dig deeper" will ask for (the route caps it too). */
export const MAX_DIG_PAGE = 20;

/** How many of a lane's `total` records to show after one more reveal. */
export function revealMore(shown: number, total: number): number {
  const current = Math.max(0, Math.min(shown, total));
  return Math.min(total, current + LOCAL_STEP);
}

/** How many to show now, given what was revealed (default: the first few). */
export function visibleCount(revealed: number | undefined, total: number): number {
  return Math.min(total, revealed ?? LOCAL_FIRST);
}

export interface FeedLane<R> {
  lane: string;
  label: string;
  results: R[];
}

/**
 * Append a fresh page of lanes onto what is on screen.
 *
 * Existing lanes keep their order and their records; new records join the
 * end of the lane they belong to; a lane that appears for the first time
 * goes after the others. A record already on screen anywhere is never added
 * twice — the server excludes what it has seen, but this is the view's own
 * guarantee and costs nothing.
 */
export function appendLanes<R extends { releaseId: number }>(
  current: readonly FeedLane<R>[],
  incoming: readonly FeedLane<R>[],
): FeedLane<R>[] {
  const onScreen = new Set<number>();
  for (const lane of current) for (const result of lane.results) onScreen.add(result.releaseId);

  const merged = current.map((lane) => ({ ...lane, results: [...lane.results] }));
  const byKey = new Map(merged.map((lane) => [lane.lane, lane]));

  for (const lane of incoming) {
    const fresh = lane.results.filter((result) => {
      if (onScreen.has(result.releaseId)) return false;
      onScreen.add(result.releaseId);
      return true;
    });
    if (fresh.length === 0) continue;

    const existing = byKey.get(lane.lane);
    if (existing) {
      existing.results.push(...fresh);
    } else {
      const added = { ...lane, results: fresh };
      merged.push(added);
      byKey.set(lane.lane, added);
    }
  }

  return merged;
}

/** How many records a page of lanes actually added. Zero means the corner is dug out. */
export function addedCount<R>(before: readonly FeedLane<R>[], after: readonly FeedLane<R>[]): number {
  const count = (lanes: readonly FeedLane<R>[]) =>
    lanes.reduce((sum, lane) => sum + lane.results.length, 0);
  return count(after) - count(before);
}

/** The next page to ask for, or null once the cap is reached. */
export function nextDigPage(page: number): number | null {
  const next = Math.max(1, Math.floor(page)) + 1;
  return next > MAX_DIG_PAGE ? null : next;
}
