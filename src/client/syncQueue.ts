/**
 * What the sync fetches next.
 *
 * A first sync is bounded by Discogs — one request per record, sixty a
 * minute — and nothing here can make that faster. What it can do is fetch
 * the right records first. The crate shows every record you own as soon as
 * the listing is read (about a minute); the slow part is filling in each
 * one's tracklist and videos. So:
 *
 *   - tap a record that is still loading, and it is in the very next batch;
 *   - search or filter during a sync, and what matches jumps the queue;
 *   - everything else keeps its order, newest additions first, the way the
 *     collection endpoint returns it.
 *
 * Pure, so the ordering can be tested without a network or a clock.
 */

/** Most priority requests the sync remembers; older ones fall off the end. */
export const MAX_PRIORITY = 200;

/**
 * Put newly requested ids at the front of the priority list, most recent
 * request first, without duplicates, capped.
 */
export function mergePriority(
  current: readonly number[],
  requested: readonly number[],
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const id of [...requested, ...current]) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PRIORITY) break;
  }
  return out;
}

/**
 * The next batch: priority ids that are still pending, in priority order,
 * then the rest of the pending list in its own order. Returns the batch and
 * what remains pending. Never invents an id and never drops one.
 */
export function nextBatch(
  pending: readonly number[],
  priority: readonly number[],
  size: number,
): { batch: number[]; rest: number[] } {
  const limit = Math.max(1, Math.floor(size));
  const waiting = new Set(pending);
  const batch: number[] = [];

  for (const id of priority) {
    if (batch.length >= limit) break;
    if (waiting.has(id) && !batch.includes(id)) batch.push(id);
  }
  for (const id of pending) {
    if (batch.length >= limit) break;
    if (!batch.includes(id)) batch.push(id);
  }

  const taken = new Set(batch);
  return { batch, rest: pending.filter((id) => !taken.has(id)) };
}
