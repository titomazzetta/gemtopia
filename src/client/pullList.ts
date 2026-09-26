/**
 * The pull list: a playlist as the list you take to the shelves.
 *
 * On a phone, an open playlist shares the screen with the video, the set-prep
 * bar and the player, which can leave room for a row or two. That is fine
 * for playing and useless for the job that comes after building a set:
 * pulling the records. For that you want the whole running order at a
 * glance, big enough to read at arm's length, with a way to tick off what is
 * already in the bag.
 *
 * Records, not just tracks: two tracks from the same record are one sleeve
 * to pull, so the second says which number it shares a sleeve with.
 */

import type { Playable } from "@/lib/types";

export interface PullRow {
  /** 1-based position in the set. */
  number: number;
  key: string;
  title: string;
  artist: string;
  releaseTitle: string;
  label: string | null;
  /** Side and track, "A1", when the clip matched a tracklist position. */
  position: string | null;
  bpm: number | null;
  /** The set number of an earlier track on the same record, if any. */
  sameRecordAs: number | null;
}

export function pullRows(items: readonly Playable[]): PullRow[] {
  const firstSeen = new Map<number, number>();
  return items.map((item, index) => {
    const number = index + 1;
    const earlier = firstSeen.get(item.releaseId) ?? null;
    if (earlier === null) firstSeen.set(item.releaseId, number);
    return {
      number,
      key: item.key,
      title: item.title,
      artist: item.artist,
      releaseTitle: item.releaseTitle,
      label: item.labels[0] ?? null,
      position: item.position?.trim() ? item.position.trim() : null,
      bpm: item.bpm,
      sameRecordAs: earlier,
    };
  });
}

/** How many sleeves the set needs pulled — distinct records, not tracks. */
export function recordCount(items: readonly Playable[]): number {
  return new Set(items.map((item) => item.releaseId)).size;
}

/** Tick or untick one row. Never mutates. */
export function togglePulled(pulled: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(pulled);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Keep only ticks for rows still in the set, so a stale tick never lingers. */
export function prunePulled(pulled: Iterable<string>, items: readonly Playable[]): Set<string> {
  const present = new Set(items.map((item) => item.key));
  return new Set([...pulled].filter((key) => present.has(key)));
}
