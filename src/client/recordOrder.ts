/**
 * The whole record, in the order it was pressed.
 *
 * The moment this serves: something good comes up on shuffle and you want to
 * hear the rest of the EP — now, in order, then carry on shuffling. The dig
 * drawer already had a "Rest of" lane, and it was the wrong shape for that in
 * four ways: it hid the track that was playing, it was not in tracklist
 * order, it left out tracks with no clip so you could not see what the
 * record actually holds, and playing from it replaced your shuffle queue so
 * there was no way back. This fixes the first three; `detour.ts` fixes the
 * fourth.
 *
 * Rows come from the Discogs tracklist when it is loaded, because the
 * tracklist is the record. Clips are then matched onto it — by position
 * first, since that is what the matcher recorded, then by title. Clips that
 * match no track (a full-side rip, an uploader's "EP mix") are returned
 * separately rather than being wedged into the running order, where they
 * would play the whole record a second time.
 */

import type { Playable, ReleaseDetail } from "@/lib/types";

export interface RecordRow {
  /** Discogs position: "A1", "B2", "3". */
  position: string;
  title: string;
  /** "5:32" as Discogs prints it, or null. */
  duration: string | null;
  /** The clip for this track, or null when Discogs has no audio for it. */
  playable: Playable | null;
  /** This is what is playing now. */
  current: boolean;
}

export interface RunningOrder {
  rows: RecordRow[];
  /** Clips from this release that are not a single track on it. */
  extras: Playable[];
}

const norm = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Tracklist order when there is no tracklist: A2 before A10, A10 before B1,
 * 2 before 10. `localeCompare` with numeric collation does exactly this, and
 * does it for "AA1" double-A sides and plain numbers alike.
 */
export function comparePositions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/**
 * `playingKey` is what is actually on the decks, which is not always the
 * seed: dig from A1, then tap B2 in the record list, and B2 is playing while
 * the drawer is still about A1. The highlight follows the audio. Pass null
 * when nothing on this record is playing; omit it and the seed is assumed to
 * be playing, which is true where the seed *is* the current track.
 */
export function runningOrder(
  seed: Playable,
  detail: ReleaseDetail | null,
  pool: readonly Playable[],
  playingKey: string | null = seed.key,
): RunningOrder {
  const clips = pool.filter((p) => p.releaseId === seed.releaseId && p.videoId !== null);
  // A record previewed from outside the collection is not in the pool, but it
  // is still the thing you are exploring.
  if (seed.videoId !== null && !clips.some((c) => c.key === seed.key)) clips.unshift(seed);

  const isCurrent = (p: Playable | null) => p !== null && playingKey !== null && p.key === playingKey;

  // Headings ("Side A", "Bonus") carry no position in Discogs tracklists. Drop
  // them — unless nothing has a position, in which case positions are simply
  // not recorded for this release and every entry is a track.
  const listed = detail?.tracks ?? [];
  const tracks = listed.some((t) => norm(t.position) !== "")
    ? listed.filter((t) => norm(t.position) !== "")
    : listed;

  if (tracks.length === 0) {
    const ordered = [...clips].sort((a, b) =>
      comparePositions(a.position ?? "~", b.position ?? "~"),
    );
    const matched = ordered.filter((c) => c.matchKind === "track");
    return {
      rows: matched.map((c) => ({
        position: c.position ?? "",
        title: c.title,
        duration: null,
        playable: c,
        current: isCurrent(c),
      })),
      extras: ordered.filter((c) => c.matchKind !== "track"),
    };
  }

  const unused = new Set(clips.map((c) => c.key));
  const take = (predicate: (c: Playable) => boolean): Playable | null => {
    const hit = clips.find((c) => unused.has(c.key) && c.matchKind === "track" && predicate(c));
    if (hit) unused.delete(hit.key);
    return hit ?? null;
  };

  const rows: RecordRow[] = tracks.map((track) => ({
    position: track.position,
    title: track.title,
    duration: track.duration,
    playable: null,
    current: false,
  }));

  // Two passes, so a title match can never steal a clip that belongs to a
  // later row by position.
  rows.forEach((row) => {
    row.playable = take((c) => norm(c.position) === norm(row.position) && norm(row.position) !== "");
  });
  rows.forEach((row) => {
    if (row.playable) return;
    row.playable = take((c) => norm(c.title) === norm(row.title));
  });
  rows.forEach((row) => {
    row.current = isCurrent(row.playable);
  });

  return { rows, extras: clips.filter((c) => unused.has(c.key)) };
}

/** Just the playable tracks, in running order — the queue for "play the record". */
export function recordQueue(order: RunningOrder): Playable[] {
  return order.rows.flatMap((row) => (row.playable ? [row.playable] : []));
}
