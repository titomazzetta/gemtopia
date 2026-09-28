/**
 * Playing a record straight from a Discogs search result.
 *
 * Search used to be for adding records only: find the pressing, open it to
 * see whether it has previews, add it. But the first thing you want after
 * finding a record — especially one you own — is to hear it. So a result's
 * tracklist is the same running-order list the dig drawer and the player
 * sheet use, and tapping a track plays the record from there.
 *
 * Searching by track name should land on that track, not on A1: the query is
 * matched against the tracklist and playback starts at the best match.
 */

import type { Playable, ReleaseDetail } from "@/lib/types";
import { buildPlayables } from "./playables";
import { recordQueue, runningOrder, type RunningOrder } from "./recordOrder";

export interface SearchRecord {
  order: RunningOrder;
  /** Playable tracks in running order — what "play from here" queues. */
  queue: Playable[];
}

/** The record as a running order, or null when Discogs has nothing to play. */
export function searchRecord(
  detail: ReleaseDetail,
  playingKey: string | null = null,
  bpmByClip?: Map<string, number>,
): SearchRecord | null {
  const clips = buildPlayables([detail], bpmByClip).filter((p) => p.videoId !== null);
  const first = clips[0];
  if (!first) return null;
  const order = runningOrder(first, detail, clips, playingKey);
  const queue = recordQueue(order);
  return { order, queue: queue.length > 0 ? queue : [first] };
}

const words = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

/**
 * Where in the queue to start for this search: the playable track whose
 * title shares the most words with the query, or the top of the record.
 * A query that is really an artist or a record title matches no track
 * better than another, so it starts at the beginning — which is right.
 */
export function startIndexFor(queue: readonly Playable[], query: string): number {
  const wanted = new Set(words(query));
  if (wanted.size === 0) return 0;
  let best = 0;
  let bestScore = 0;
  queue.forEach((item, index) => {
    const score = words(item.title).filter((w) => wanted.has(w)).length;
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}
