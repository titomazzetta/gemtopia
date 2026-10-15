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
  /**
   * Playable tracks in running order — what "play from here" queues. Empty
   * for a record with no clips at all: it still has a tracklist, every track
   * record only.
   */
  queue: Playable[];
}

/**
 * The record as a running order, or null when there is neither a clip to
 * play nor a tracklist to list.
 *
 * A pressing with no previews used to come back null and showed as a plain,
 * dead list of titles — on the one screen where you are most likely to be
 * holding the record. Now its tracks are rows like anywhere else, each one
 * "record only": open it to tap its BPM along to the record, or add it to a
 * set.
 */
export function searchRecord(
  detail: ReleaseDetail,
  playingKey: string | null = null,
  bpmByClip?: Map<string, number>,
): SearchRecord | null {
  const built = buildPlayables([detail], bpmByClip);
  const clips = built.filter((p) => p.videoId !== null);
  const first = clips[0] ?? built.find((p) => p.silence === "record-only");
  if (!first) return null;
  // All of it, not just the clips: the record-only rows it built carry your
  // catalogue's BPM when one was passed in.
  const order = runningOrder(first, detail, built, playingKey);
  const queue = recordQueue(order);
  return { order, queue: queue.length > 0 || clips.length === 0 ? queue : [first] };
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
