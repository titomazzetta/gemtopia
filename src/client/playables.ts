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

function matchTrack(
  videoTitle: string,
  artist: string,
  tracks: Track[],
): Track | null {
  if (tracks.length === 0) return null;
  if (LONGFORM.test(videoTitle)) return null;

  // Strip a leading "Artist - " so it does not dominate the token overlap.
  const normalizedArtist = normalize(artist);
  let candidate = normalize(videoTitle);
  if (normalizedArtist && candidate.startsWith(normalizedArtist)) {
    candidate = candidate.slice(normalizedArtist.length).trim();
  }
  if (!candidate) return null;

  let best: Track | null = null;
  let bestScore = 0;

  for (const track of tracks) {
    const score = similarity(candidate, normalize(track.title));
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }

  return bestScore >= 0.6 ? best : null;
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
export function buildPlayables(
  details: ReleaseDetail[],
  bpmByClip: Map<string, number> = new Map(),
): Playable[] {
  const out: Playable[] = [];

  for (const release of details) {
    // BPM markings written into the release notes apply to the whole record;
    // per-track markings in the title win over them.
    const releaseBpm = parseBpmFromText(release.notes);

    for (const video of release.videos) {
      const track = matchTrack(video.title, release.artist, release.tracks);
      const key = `${release.id}:${video.id}`;

      const title = track ? track.title : video.title || release.title;

      const artist =
        track && track.artists.length > 0
          ? track.artists.join(", ")
          : release.artist;

      const parsedBpm =
        parseBpmFromText(track?.title) ??
        parseBpmFromText(video.title) ??
        releaseBpm;

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
        duration: video.duration ?? (track ? parseDuration(track.duration) : null),
        position: track?.position ?? null,
        // A catalogued reading (tapped or detected) always beats text parsing.
        bpm: bpmByClip.get(key) ?? parsedBpm,
        matchKind: track ? "track" : "release",
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
