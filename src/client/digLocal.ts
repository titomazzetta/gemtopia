"use client";

import type { Playable } from "@/lib/types";

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
  options: { bpmTolerance?: number } = {},
): LocalLane[] {
  const tolerance = options.bpmTolerance ?? 3;
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

  /* ---- same release (the rest of the record) ---- */
  const sameRelease = pool.filter(
    (p) => p.releaseId === seed.releaseId && p.key !== seed.key,
  );
  if (sameRelease.length > 0) {
    lanes.push({
      key: "release",
      label: "Rest of",
      pivot: seed.releaseTitle,
      results: sameRelease.slice(0, MAX_PER_LANE),
    });
  }

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
    const matches = pool
      .filter((p) => {
        if (p.bpm === null || p.key === seed.key) return false;
        // Half and double time count as mixable — a 140 track drops into a
        // 70 set and vice versa, which is the whole point of the ×2 / ÷2
        // controls elsewhere in the app.
        return (
          Math.abs(p.bpm - target) <= tolerance ||
          Math.abs(p.bpm - target * 2) <= tolerance * 2 ||
          Math.abs(p.bpm - target / 2) <= tolerance
        );
      })
      .sort((a, b) => Math.abs((a.bpm ?? 0) - target) - Math.abs((b.bpm ?? 0) - target));

    if (matches.length > 0) {
      lanes.push({
        key: "tempo",
        label: "Mixes with",
        pivot: `${target} BPM`,
        results: matches.slice(0, MAX_PER_LANE),
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
