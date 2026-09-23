"use client";

import type { Playable } from "@/lib/types";
import { checkMix, DEFAULT_PITCH_PERCENT } from "@/lib/mixing";

/**
 * Digging *inside* your own crate. No network, no latency.
 *
 * The split matters to how the app feels: pivoting on something you already
 * own should be instant, because you are standing in front of your own
 * records. Only the "beyond the crate" lanes talk to Discogs.
 *
 * Every lane is derived from Discogs metadata already in the local cache —
 * artist, label, style, year, and the BPM catalogue.
 */

export interface LocalLane {
  key: string;
  label: string;
  /** What the pivot was, so the UI can say "Deep House" not "style". */
  pivot: string;
  results: Playable[];
}

const MAX_PER_LANE = 40;

function unique(items: Playable[], excludeKey: string): Playable[] {
  const seen = new Set<string>([excludeKey]);
  const out: Playable[] = [];
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

export function digWithinCollection(
  seed: Playable,
  pool: Playable[],
  options: { pitchPercent?: number } = {},
): LocalLane[] {
  const pitchPercent = options.pitchPercent ?? DEFAULT_PITCH_PERCENT;
  const lanes: LocalLane[] = [];

  /* ---- same artist ---- */
  const artistKey = seed.artist.toLowerCase();
  const sameArtist = pool.filter(
    (p) => p.artist.toLowerCase() === artistKey && p.key !== seed.key,
  );
  if (sameArtist.length > 0) {
    lanes.push({
      key: "artist",
      label: "More by",
      pivot: seed.artist,
      results: unique(sameArtist, seed.key).slice(0, MAX_PER_LANE),
    });
  }

  /*
   * No "rest of the record" lane. It used to live here, and the dig drawer now
   * shows the whole record above every lane instead — in tracklist order,
   * including the playing track and tracks with no clip, and played as a
   * detour you can return from. See client/recordOrder.ts. Keeping this lane
   * as well would list the same tracks twice, once in the wrong order.
   */

  /* ---- same label ---- */
  for (const label of seed.labels.slice(0, 2)) {
    const matches = pool.filter(
      (p) => p.labels.includes(label) && p.key !== seed.key,
    );
    if (matches.length > 1) {
      lanes.push({
        key: `label:${label}`,
        label: "On",
        pivot: label,
        results: unique(matches, seed.key).slice(0, MAX_PER_LANE),
      });
    }
  }

  /* ---- same style ---- */
  for (const style of seed.styles.slice(0, 2)) {
    const matches = pool.filter(
      (p) => p.styles.includes(style) && p.key !== seed.key,
    );
    if (matches.length > 1) {
      lanes.push({
        key: `style:${style}`,
        label: "More",
        pivot: style,
        results: unique(matches, seed.key).slice(0, MAX_PER_LANE),
      });
    }
  }

  /* ---- same era ---- */
  if (seed.year) {
    const from = seed.year - 2;
    const to = seed.year + 2;
    const matches = pool.filter(
      (p) => p.year !== null && p.year >= from && p.year <= to && p.key !== seed.key,
    );
    if (matches.length > 1) {
      lanes.push({
        key: "era",
        label: "From",
        pivot: `${from}–${to}`,
        results: unique(matches, seed.key).slice(0, MAX_PER_LANE),
      });
    }
  }

  /* ---- mixable tempo ---- */
  if (seed.bpm !== null) {
    const target = seed.bpm;

    // Not "within N BPM" — a pitch fader is a percentage, and both decks have
    // one. `checkMix` handles that, plus the half- and double-time cases.
    const scored = pool
      .filter((p) => p.bpm !== null && p.key !== seed.key)
      .map((p) => ({ item: p, check: checkMix(target, p.bpm, pitchPercent) }))
      .filter(({ check }) => check.verdict !== "stretch" && check.verdict !== "impossible")
      .sort(
        (a, b) =>
          (a.check.requiredPercent ?? 99) - (b.check.requiredPercent ?? 99),
      );

    if (scored.length > 0) {
      lanes.push({
        key: "tempo",
        label: "Mixes with",
        pivot: `${target} BPM at ±${pitchPercent}%`,
        results: scored.slice(0, MAX_PER_LANE).map((s) => s.item),
      });
    }
  }

  /* ---- same country ---- */
  if (seed.country) {
    const matches = pool.filter(
      (p) => p.country === seed.country && p.key !== seed.key,
    );
    if (matches.length > 3) {
      lanes.push({
        key: "country",
        label: "Pressed in",
        pivot: seed.country,
        results: unique(matches, seed.key).slice(0, MAX_PER_LANE),
      });
    }
  }

  return lanes;
}
