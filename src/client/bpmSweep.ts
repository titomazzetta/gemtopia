"use client";

import type { Playable } from "@/lib/types";

/**
 * Measuring the tempo of a list of records, unattended.
 *
 * The naive version of this feature was "analyse my whole collection", and it
 * doesn't work: there is no audio file to analyse. The only route to samples is
 * capturing the tab's audio while it plays, in real time, so a 1,500-record
 * crate is about five hours of playback. That is a chore, not a feature.
 *
 * Scoped to a list it is a different thing entirely. A 20-track set is six to
 * ten minutes, and it lands exactly where the numbers are needed — the
 * mixability check on the set you are prepping. Point it at a playlist before a
 * gig, or at a filtered slice of the crate to chip away at the collection a
 * style at a time. Same machinery, and the second use is the first one
 * repeated, which is why this takes a list rather than knowing about playlists.
 *
 * Everything measured is written to the server as it lands, so a sweep that is
 * interrupted — closed tab, dead battery, a phone call — keeps every reading it
 * had already taken. There is no "finish or lose it".
 */

export interface SweepState {
  /** Clip keys still to measure, in order. */
  readonly keys: readonly string[];
  /** Position within `keys`. */
  readonly index: number;
  /** Readings that landed. */
  readonly measured: number;
  /** Tracks that played long enough and never produced a confident reading. */
  readonly failed: number;
  /** Tracks already carrying a BPM when the sweep was built. */
  readonly skipped: number;
}

/**
 * How long to give one track before moving on.
 *
 * The estimator needs a 14-second window plus three agreeing readings at two
 * second intervals — about twenty seconds when a track is cooperative. Fifty
 * gives an ambient intro or a long breakdown time to reach something with a
 * beat in it, without stalling the sweep on a record that is never going to
 * yield one.
 */
export const TRACK_TIMEOUT_MS = 50_000;

/**
 * Build a sweep over `items`, skipping anything that already has a tempo.
 *
 * Skipping is the whole economy of the feature: run it on the same playlist
 * twice and the second run only covers what you have added since. It also
 * means a sweep interrupted halfway resumes rather than restarts, because the
 * readings it already took are now reasons to skip.
 *
 * `force` re-measures everything, for when a reading is suspect rather than
 * missing — though a single track is better handled by clearing that one
 * reading, which is what the ✕ does.
 */
export function planSweep(
  items: readonly Playable[],
  bpmOf: (key: string) => number | null | undefined,
  { force = false }: { force?: boolean } = {},
): SweepState {
  const keys: string[] = [];
  let skipped = 0;

  for (const item of items) {
    // Only clips with something to play can be measured at all.
    if (!item.videoId) continue;

    const existing = bpmOf(item.key);
    if (!force && existing !== null && existing !== undefined) {
      skipped += 1;
      continue;
    }
    keys.push(item.key);
  }

  return { keys, index: 0, measured: 0, failed: 0, skipped };
}

/** Move to the next track, recording how the current one went. */
export function advanceSweep(
  sweep: SweepState,
  outcome: "measured" | "failed",
): SweepState {
  return {
    ...sweep,
    index: sweep.index + 1,
    measured: sweep.measured + (outcome === "measured" ? 1 : 0),
    failed: sweep.failed + (outcome === "failed" ? 1 : 0),
  };
}

export function sweepFinished(sweep: SweepState): boolean {
  return sweep.index >= sweep.keys.length;
}

/** The clip currently being measured, or null when the sweep is done. */
export function sweepCurrentKey(sweep: SweepState): string | null {
  return sweep.keys[sweep.index] ?? null;
}

/**
 * What to tell the user when it stops.
 *
 * Reports failures plainly rather than hiding them. A track that produced no
 * reading is not a bug — sparse dub, ambient, spoken intros and anything the
 * estimator was not confident about are all declined on purpose, because a
 * confident wrong number is worse than none. Saying so points the user at the
 * tap button rather than leaving them to wonder.
 */
export function sweepSummary(sweep: SweepState): string {
  const parts: string[] = [];

  if (sweep.measured > 0) {
    parts.push(`${sweep.measured} measured`);
  }
  if (sweep.failed > 0) {
    parts.push(`${sweep.failed} gave no clear beat — tap those`);
  }
  if (sweep.skipped > 0) {
    parts.push(`${sweep.skipped} already had one`);
  }

  if (parts.length === 0) return "Nothing to measure.";
  return parts.join(" · ");
}
