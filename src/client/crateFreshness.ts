import type { SyncState } from "@/lib/types";

/**
 * How long a finished sync is trusted before the app looks again.
 *
 * Fifteen minutes is chosen against two failure modes, not picked round. Too
 * long and a record bought this morning stays invisible; too short and a burst
 * of tab reloads re-lists the whole collection against a 60-request minute
 * shared with everything else the app does.
 */
export const FRESH_FOR_MS = 15 * 60 * 1000;

/**
 * Should the app re-check Discogs for records it has not seen?
 *
 * Extracted from the boot effect because the rule has already been wrong once
 * and had no way to be tested. It used to read `!state || state.status !==
 * "done"` — meaning that once a sync completed, the app never looked again.
 * You could buy a record on Tuesday and it stayed invisible until you found
 * the resync button. For an app aimed at people who buy records constantly,
 * that was the wrong default, and nothing failed when it was wrong.
 *
 * Re-checking is nearly free: `getCollectionPage` already asks Discogs for
 * `sort=added&sort_order=desc`, so the first page *is* the newest additions
 * and one request answers "did anything appear?". Details are only fetched for
 * releases that are not already cached, so an unchanged collection costs a
 * single call.
 *
 * `now` is a parameter rather than a call to Date.now() so the window is
 * testable without waiting fifteen minutes or mocking the clock.
 */
export function needsSync(
  state: SyncState | null,
  now: number = Date.now(),
): boolean {
  // Never synced on this device: there is no crate to show yet.
  if (!state) return true;

  // Interrupted, failed, or still going — resume rather than trust it.
  if (state.status !== "done") return true;

  /*
   * A timestamp in the future means a clock moved, not that the sync is
   * impossibly fresh. Treating it as fresh would pin the crate until the
   * clock caught up, so it counts as stale and the app looks again.
   */
  const age = now - state.updatedAt;
  if (age < 0) return true;

  return age > FRESH_FOR_MS;
}
