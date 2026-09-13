"use client";

import type { Playable, ReleaseDetail, Track } from "@/lib/types";
import { parseBpmFromText } from "./tempo";

/**
 * Turning Discogs data into a playable queue.
 *
 * The awkward truth of the Discogs data model: videos are attached to a
 * *release*, not to a track. A release with 8 tracks might have 8 videos, or
 * 1 video of the whole side, or 3 videos with titles like
 * "Artist - Track Name (Original Mix) [HQ]".
 *
 * So we do best-effort matching of video titles against the tracklist, and we
 * label every entry with how confident we are. The UI shows that label rather
 * than pretending every clip is a clean single track.
 */

const NOISE = [
  /\bofficial\s*(music\s*)?video\b/gi,
  /\bofficial\s*audio\b/gi,
  /\blyrics?\s*video\b/gi,
  /\bhd\b/gi,
  /\bhq\b/gi,
  /\b4k\b/gi,
  /\b1080p?\b/gi,
  /\bremaster(ed)?\b/gi,
  /\bfull\s*album\b/gi,
  /\bfull\s*ep\b/gi,
  /\bvinyl\s*rip\b/gi,
  /\baudio\s*only\b/gi,
  /\bwith\s*lyrics\b/gi,
];

/** Markers that a clip is a whole side, album, or mix rather than one track. */
const LONGFORM = /\b(full\s*(album|ep|lp|length)|side\s*[ab]\b|mixtape|dj\s*mix|continuous\s*mix|megamix|complete)\b/i;

function normalize(input: string): string {
  let out = input.toLowerCase();
  for (const pattern of NOISE) out = out.replace(pattern, " ");
  return out
    // Drop bracketed qualifiers: [HQ], (Original Mix), {2019}
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cheap token-overlap score in [0, 1]. Good enough, no fuzzy-match dep. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const tokensA = new Set(a.split(" ").filter((t) => t.length > 2));
  const tokensB = new Set(b.split(" ").filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.min(tokensA.size, tokensB.size);
}

export interface TrackMatch {
  track: Track | null;
  /** Title-overlap score in [0,1] for the winning track, 0 if none matched. */
  score: number;
  /** The clip announces itself as a whole side, album or mix. */
  longform: boolean;
}

function matchTrack(
  videoTitle: string,
  artist: string,
  tracks: Track[],
): TrackMatch {
  const longform = LONGFORM.test(videoTitle);
  if (tracks.length === 0) return { track: null, score: 0, longform };
  if (longform) return { track: null, score: 0, longform };

  // Strip a leading "Artist - " so it does not dominate the token overlap.
  const normalizedArtist = normalize(artist);
  let candidate = normalize(videoTitle);
  if (normalizedArtist && candidate.startsWith(normalizedArtist)) {
    candidate = candidate.slice(normalizedArtist.length).trim();
  }
  if (!candidate) return { track: null, score: 0, longform };

  let best: Track | null = null;
  let bestScore = 0;

  for (const track of tracks) {
    const score = similarity(candidate, normalize(track.title));
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }

  return bestScore >= 0.6
    ? { track: best, score: bestScore, longform }
    : { track: null, score: bestScore, longform };
}

/** "3:47" -> 227 seconds. */
export function parseDuration(value: string | null): number | null {
  if (!value) return null;
  const parts = value.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

/**
 * Build the playable list.
 *
 * `bpmByClip` merges the server-held BPM catalogue in as the playables are
 * constructed, so filtering and sorting by tempo needs no second lookup.
 */
/**
 * How close a clip's runtime is to the tracklist's stated duration, in [0,1].
 *
 * This is the strongest signal available for "is this actually the track".
 * A 6-minute upload against a 6:12 listing is almost certainly it; the same
 * track title against a 43-minute upload is the full album with the track
 * somewhere inside it.
 */
function durationFit(clipSeconds: number | null, trackSeconds: number | null): number {
  if (!clipSeconds || !trackSeconds) return 0;
  const ratio = Math.min(clipSeconds, trackSeconds) / Math.max(clipSeconds, trackSeconds);
  // 0.85+ is a good fit; below 0.5 the two are not the same recording.
  return ratio >= 0.85 ? 1 : ratio >= 0.6 ? 0.5 : 0;
}

/** Middle value, which is what we want rather than a mean skewed by a DJ rip. */
function median(values: number[]): number | null {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Rank competing clips for the same track. Higher wins.
 *
 * Deliberately ordered so that runtime agreement outweighs a confident title
 * match: YouTube titles are written by uploaders and lie constantly, while a
 * duration either lines up with the pressing or it doesn't.
 *
 * `reference` is the runtime this track is believed to have. Discogs' own
 * tracklist duration when there is one — but Discogs durations are blank far
 * more often than not, especially on early-nineties twelves, and that is
 * exactly where the duplicates pile up. When it is blank, the uploads vote:
 * the median of the group. Sixteen people who each uploaded the same record
 * agree on its length to within a few seconds, and the outliers at either end
 * are a radio edit and somebody's extended rip. The middle is the record.
 */
function clipScore(
  video: { duration: number | null; title: string },
  match: TrackMatch,
  reference: number | null,
): number {
  let score = 0;
  score += durationFit(video.duration, reference) * 4;
  score += match.score * 2;
  if (video.duration) score += 0.5; // a known runtime at all is worth something
  if (match.longform) score -= 3; // a side-long rip is a poor single-track clip
  return score;
}

/**
 * Build the playable list — one row per *track*, not per video.
 *
 * Discogs attaches videos to releases, and uploaders are enthusiastic: a single
 * release routinely carries the same track three times over, plus a full-album
 * rip, plus someone's vinyl transfer. Emitting one row per video (which this
 * did until now) turned a 4-track EP into fourteen near-identical lines, and
 * made the crate look broken at a glance.
 *
 * Grouping rules, in order:
 *
 *   1. Clips that matched the same track collapse into one row.
 *   2. Clips that matched nothing group by normalised title, so two uploads of
 *      the same unrecognised track collapse but genuinely different ones don't.
 *   3. Anything left with the same runtime (within 2s) and a near-identical
 *      title collapses too — the case where two uploads of one track matched
 *      different tracklist entries, or matched nothing at all.
 *
 * Within a group the highest-scoring clip wins (see `clipScore`), so
 * deduplicating never costs you the best-sounding preview — it discards the
 * worse copies, not an arbitrary one.
 *
 * `bpmByClip` merges the server-held BPM catalogue in as the playables are
 * constructed, so filtering and sorting by tempo needs no second lookup. A BPM
 * you already catalogued against a clip that loses its group is carried over to
 * the winner rather than thrown away — you tapped that tempo, you keep it.
 */
export function buildPlayables(
  details: ReleaseDetail[],
  bpmByClip: Map<string, number> = new Map(),
): Playable[] {
  const out: Playable[] = [];

  for (const release of details) {
    // BPM markings written into the release notes apply to the whole record;
    // per-track markings in the title win over them.
    const releaseBpm = parseBpmFromText(release.notes);

    /*
     * A record with no clips used to produce no rows, which meant it did not
     * exist. You could own it, sync it successfully, and never once see it in
     * the app — and there was nothing on screen to tell you that was
     * happening. One row, marked, is the honest version.
     *
     * Which kind of silence it is matters. `market` is the tell: a real fetch
     * of /releases/{id} always returns num_for_sale and lowest_price, so a
     * null market can only be a placeholder the sync wrote when it never got
     * to the release at all. Calling that "Discogs has no audio" would be a
     * confident wrong answer about a record you can hear on Discogs right now.
     */
    if (release.videos.length === 0) {
      out.push({
        key: `${release.id}:silent`,
        releaseId: release.id,
        videoId: null,
        title: release.title,
        artist: release.artist,
        releaseTitle: release.title,
        year: release.year,
        genres: release.genres,
        styles: release.styles,
        labels: release.labels,
        thumb: release.thumb,
        country: release.country,
        formats: release.formats,
        duration: null,
        position: null,
        // Parsed from the release notes, so it is real information about the
        // record even though nothing here can play it.
        bpm: releaseBpm,
        matchKind: "release",
        silence: release.market === null ? "not-loaded" : "no-audio",
      });
      continue;
    }

    interface Candidate {
      video: ReleaseDetail["videos"][number];
      match: TrackMatch;
      trackSeconds: number | null;
      score: number;
      normTitle: string;
      key: string;
    }

    const groups = new Map<string, Candidate[]>();

    for (const video of release.videos) {
      const match = matchTrack(video.title, release.artist, release.tracks);
      const trackSeconds = match.track ? parseDuration(match.track.duration) : null;
      const normTitle = normalize(video.title);

      // Rule 1 and 2: one group per matched track, else per normalised title.
      const groupKey = match.track
        ? `t:${match.track.position || normalize(match.track.title)}`
        : `u:${normTitle || video.id}`;

      const candidate: Candidate = {
        video,
        match,
        trackSeconds,
        // Scored below, once the whole group is known: a clip can only be
        // judged against its siblings.
        score: 0,
        normTitle,
        key: `${release.id}:${video.id}`,
      };

      const existing = groups.get(groupKey);
      if (existing) existing.push(candidate);
      else groups.set(groupKey, [candidate]);
    }

    // Rule 3: fold groups whose winners are the same recording by another name.
    const winners: Candidate[] = [];
    const losersOf = new Map<Candidate, Candidate[]>();

    for (const group of groups.values()) {
      // The track's believed runtime: Discogs' figure, else what the uploads
      // agree on. See clipScore.
      const reference =
        group[0]?.trackSeconds ??
        median(group.map((c) => c.video.duration ?? 0));

      for (const candidate of group) {
        candidate.score = clipScore(candidate.video, candidate.match, reference);
      }

      // Ties break on the clip nearest the reference, then on Discogs' own
      // ordering, so the result never depends on Map iteration luck.
      group.sort(
        (a, b) =>
          b.score - a.score ||
          Math.abs((a.video.duration ?? 0) - (reference ?? 0)) -
            Math.abs((b.video.duration ?? 0) - (reference ?? 0)),
      );
      const [winner, ...rest] = group;
      if (!winner) continue;

      const twin = winners.find((existing) => {
        const bothTimed = existing.video.duration && winner.video.duration;
        const sameLength =
          bothTimed &&
          Math.abs(existing.video.duration! - winner.video.duration!) <= 2;
        return sameLength && similarity(existing.normTitle, winner.normTitle) >= 0.8;
      });

      if (twin) {
        // Keep whichever scores better; the other becomes a donor of its BPM.
        const [keep, drop] = twin.score >= winner.score ? [twin, winner] : [winner, twin];
        if (keep === winner) {
          winners.splice(winners.indexOf(twin), 1, winner);
          losersOf.set(winner, [...(losersOf.get(twin) ?? []), twin, ...rest]);
          losersOf.delete(twin);
        } else {
          losersOf.set(keep, [...(losersOf.get(keep) ?? []), drop, ...rest]);
        }
        continue;
      }

      winners.push(winner);
      if (rest.length > 0) losersOf.set(winner, rest);
    }

    /*
     * A side-long or full-album rip is a fallback, not an extra row. If any
     * clip on this release resolved to a real track, the whole-record upload
     * adds nothing but noise — you already have the tracks. If nothing matched,
     * it is the only way to hear the record, so it stays.
     *
     * Note this drops only *longform* unmatched clips. An ordinary clip that
     * simply failed to match the tracklist is very often a real track under a
     * title the matcher didn't recognise, and throwing those away would hide
     * music rather than tidy the list.
     */
    const hasTrackMatch = winners.some((w) => w.match.track !== null);
    const kept = hasTrackMatch
      ? winners.filter((w) => w.match.track !== null || !w.match.longform)
      : winners;

    for (const winner of kept) {
      const { video, match, trackSeconds, key } = winner;
      const track = match.track;

      const title = track ? track.title : video.title || release.title;

      const artist =
        track && track.artists.length > 0
          ? track.artists.join(", ")
          : release.artist;

      const parsedBpm =
        parseBpmFromText(track?.title) ??
        parseBpmFromText(video.title) ??
        releaseBpm;

      // A tempo catalogued against a discarded duplicate still describes this
      // recording, so inherit it rather than making the user tap it again.
      const inheritedBpm =
        bpmByClip.get(key) ??
        (losersOf.get(winner) ?? [])
          .map((loser) => bpmByClip.get(loser.key))
          .find((value) => value !== undefined);

      out.push({
        key,
        releaseId: release.id,
        videoId: video.id,
        title,
        artist,
        releaseTitle: release.title,
        year: release.year,
        genres: release.genres,
        styles: release.styles,
        labels: release.labels,
        thumb: release.thumb,
        country: release.country,
        formats: release.formats,
        duration: video.duration ?? trackSeconds,
        position: track?.position ?? null,
        // A catalogued reading (tapped or detected) always beats text parsing.
        bpm: inheritedBpm ?? parsedBpm,
        matchKind: track ? "track" : "release",
        silence: null,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Shuffle                                                             */
/* ------------------------------------------------------------------ */

/**
 * Unbiased Fisher–Yates using crypto randomness.
 *
 * `Math.random()` would be fine for a playlist, but using the CSPRNG costs
 * nothing here and means there is exactly one source of randomness in the
 * codebase to reason about.
 */
export function shuffle<T>(input: readonly T[]): T[] {
  const array = [...input];
  const randoms = new Uint32Array(array.length);
  crypto.getRandomValues(randoms);

  for (let i = array.length - 1; i > 0; i--) {
    const j = randoms[i]! % (i + 1);
    const tmp = array[i]!;
    array[i] = array[j]!;
    array[j] = tmp;
  }
  return array;
}

/**
 * Shuffle, then reorder so the same release does not appear twice in a row
 * where that is avoidable. A pure shuffle of a crate full of 6-track EPs
 * clumps badly, which reads as "broken" to a DJ even though it is correct.
 */
export function spreadShuffle(items: readonly Playable[]): Playable[] {
  const shuffled = shuffle(items);
  if (shuffled.length < 3) return shuffled;

  const result: Playable[] = [];
  const pending = [...shuffled];

  while (pending.length > 0) {
    const previous = result[result.length - 1];
    let index = 0;

    if (previous) {
      const found = pending.findIndex((p) => p.releaseId !== previous.releaseId);
      if (found !== -1) index = found;
    }

    result.push(pending[index]!);
    pending.splice(index, 1);
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Silent records                                                      */
/* ------------------------------------------------------------------ */

/**
 * The records a queue may contain.
 *
 * A silent record is shown in the crate on purpose — you own it, and hiding
 * it was worse — but it can never be *played*, so it must never enter a
 * queue. Doing that filtering here rather than at each call site means the
 * player's "what do I do with a null video id" branch stays unreachable in
 * normal operation instead of becoming load-bearing.
 */
export function playableOnly(items: readonly Playable[]): Playable[] {
  return items.filter((item) => item.videoId !== null);
}

export interface QueuePlan {
  queue: Playable[];
  index: number;
}

/**
 * Build a queue from a list the user is looking at, starting at what they
 * pressed.
 *
 * The index needs re-deriving rather than reusing: the visible list contains
 * silent records and the queue does not, so position 40 on screen is not
 * position 40 in the queue, and playing the wrong record because of an
 * off-by-n is precisely the sort of thing nobody notices in review.
 *
 * Returns null when there is nothing to play — either the list is all silent,
 * or the row pressed was itself a silent one. The caller says which, because
 * only the caller knows how to phrase it.
 */
export function queueFrom(
  items: readonly Playable[],
  index: number,
): QueuePlan | null {
  const target = items[index] ?? null;
  const queue = playableOnly(items);
  if (queue.length === 0) return null;

  if (target === null) return { queue, index: 0 };
  if (target.videoId === null) return null;

  const found = queue.findIndex((item) => item.key === target.key);
  return { queue, index: found === -1 ? 0 : found };
}

/**
 * How many of these the app cannot play, split by whose fault it is.
 *
 * Kept separate because the two numbers lead somewhere different: records
 * Discogs has no audio for are permanent and there is nothing to do about
 * them, whereas records the sync never loaded are a resync away from working.
 */
export function countSilence(items: readonly Playable[]): {
  playable: number;
  noAudio: number;
  notLoaded: number;
} {
  let playable = 0;
  let noAudio = 0;
  let notLoaded = 0;

  for (const item of items) {
    if (item.silence === null) playable += 1;
    else if (item.silence === "no-audio") noAudio += 1;
    else notLoaded += 1;
  }

  return { playable, noAudio, notLoaded };
}
