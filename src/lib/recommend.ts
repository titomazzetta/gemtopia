import "server-only";
import {
  getArtistReleases,
  getLabelReleases,
  DiscogsError,
  type RelatedRelease,
} from "./discogs";
import type {
  PlaylistProfile,
  Recommendation,
  Weighted,
} from "./types";

/**
 * Playlist dissection and recommendation.
 *
 * The design principle: **every recommendation is a real Discogs release with
 * a real id, found by walking real relationships.** The graph decides *what*
 * to suggest; the optional LLM layer (see llm.ts) only ever reorders and
 * explains what the graph already found. That ordering is deliberate — a model
 * asked to name records will invent catalogue numbers that do not exist, and a
 * DJ acting on a hallucinated release finds out at the record shop.
 *
 * The walk:
 *
 *   playlist ──▶ artists ──▶ their other releases          "same artist"
 *            │           └─▶ labels they released on ──┐
 *            └──▶ labels ─▶ other releases on it  ─────┤  "same label"
 *                        └─▶ labelmate artists ────────┴─▶ "labelmate"
 *
 * Everything already in the collection is filtered out at the end, because a
 * recommendation you already own is noise.
 */

export interface Seed {
  releaseId: number;
  artistIds: number[];
  artistNames: string[];
  labelIds: number[];
  labelNames: string[];
  styles: string[];
  genres: string[];
  country: string | null;
  year: number | null;
}

interface UserToken {
  token: string;
  tokenSecret: string;
}

/* ------------------------------------------------------------------ */
/* Profiling                                                           */
/* ------------------------------------------------------------------ */

function tally(values: string[][], limit = 12): Weighted[] {
  const counts = new Map<string, number>();
  let total = 0;

  for (const group of values) {
    // Count each value once per release, not once per occurrence, so a
    // release credited to the same label twice does not skew the profile.
    for (const value of new Set(group)) {
      if (!value) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
      total += 1;
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({
      name,
      count,
      share: total > 0 ? Math.round((count / total) * 1000) / 1000 : 0,
    }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1]! + sorted[middle]!) / 2) * 10) / 10
    : sorted[middle]!;
}

export function buildProfile(
  seeds: Seed[],
  trackCount: number,
  bpms: number[],
): PlaylistProfile {
  const years = seeds.map((s) => s.year).filter((y): y is number => y !== null);

  return {
    trackCount,
    releaseCount: seeds.length,
    artists: tally(seeds.map((s) => s.artistNames)),
    labels: tally(seeds.map((s) => s.labelNames)),
    styles: tally(seeds.map((s) => s.styles)),
    genres: tally(seeds.map((s) => s.genres), 8),
    countries: tally(
      seeds.map((s) => (s.country ? [s.country] : [])),
      8,
    ),
    decades: tally(
      seeds.map((s) => (s.year ? [`${Math.floor(s.year / 10) * 10}s`] : [])),
      8,
    ),
    yearRange:
      years.length > 0
        ? { from: Math.min(...years), to: Math.max(...years) }
        : null,
    bpm: {
      known: bpms.length,
      median: median(bpms),
      min: bpms.length > 0 ? Math.min(...bpms) : null,
      max: bpms.length > 0 ? Math.max(...bpms) : null,
    },
    adjacentLabels: [],
  };
}

/* ------------------------------------------------------------------ */
/* Candidate generation                                                */
/* ------------------------------------------------------------------ */

interface Candidate {
  release: RelatedRelease;
  score: number;
  signals: Set<string>;
}

/** How many Discogs requests one analysis may spend. */
const MAX_ARTIST_LOOKUPS = 6;
const MAX_LABEL_LOOKUPS = 6;

/** Bounded concurrency so we stay well inside 60 requests/minute. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];

  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (;;) {
        const item = queue.shift();
        if (item === undefined) return;
        try {
          results.push(await run(item));
        } catch (error) {
          // One dead artist page must not sink the whole analysis.
          if (error instanceof DiscogsError && error.status === 429) throw error;
          console.warn("[recommend] lookup failed", error);
        }
      }
    }),
  );

  return results;
}

/** Weight of a seed entity: how much of the playlist it accounts for. */
function weightMap(entries: Array<{ id: number; name: string }>): Map<
  number,
  { name: string; weight: number }
> {
  const counts = new Map<number, { name: string; count: number }>();
  for (const entry of entries) {
    const existing = counts.get(entry.id);
    if (existing) existing.count += 1;
    else counts.set(entry.id, { name: entry.name, count: 1 });
  }

  const max = Math.max(1, ...[...counts.values()].map((v) => v.count));
  const out = new Map<number, { name: string; weight: number }>();
  for (const [id, value] of counts) {
    out.set(id, { name: value.name, weight: value.count / max });
  }
  return out;
}

export async function generateRecommendations(params: {
  user: UserToken;
  seeds: Seed[];
  profile: PlaylistProfile;
  owned: Set<number>;
  wantlist: Set<number>;
  limit?: number;
}): Promise<{ recommendations: Recommendation[]; adjacentLabels: Weighted[] }> {
  const { user, seeds, owned, wantlist } = params;
  const limit = params.limit ?? 24;

  const seedReleaseIds = new Set(seeds.map((s) => s.releaseId));
  const playlistStyles = new Set(
    params.profile.styles.map((s) => s.name.toLowerCase()),
  );
  const yearRange = params.profile.yearRange;

  /* ---- rank the entities to walk from ---- */

  const artistEntries: Array<{ id: number; name: string }> = [];
  for (const seed of seeds) {
    seed.artistIds.forEach((id, i) => {
      artistEntries.push({ id, name: seed.artistNames[i] ?? `Artist ${id}` });
    });
  }

  const labelEntries: Array<{ id: number; name: string }> = [];
  for (const seed of seeds) {
    seed.labelIds.forEach((id, i) => {
      labelEntries.push({ id, name: seed.labelNames[i] ?? `Label ${id}` });
    });
  }

  const artistWeights = weightMap(artistEntries);
  const labelWeights = weightMap(labelEntries);

  const topArtists = [...artistWeights.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, MAX_ARTIST_LOOKUPS);
  const topLabels = [...labelWeights.entries()]
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, MAX_LABEL_LOOKUPS);

  const candidates = new Map<number, Candidate>();

  const add = (
    release: RelatedRelease,
    signal: string,
    weight: number,
  ): void => {
    if (release.id <= 0) return;
    if (seedReleaseIds.has(release.id)) return;

    const existing = candidates.get(release.id);
    if (existing) {
      existing.score += weight;
      existing.signals.add(signal);
      return;
    }
    candidates.set(release.id, {
      release,
      score: weight,
      signals: new Set([signal]),
    });
  };

  /* ---- hop 1: what else did these artists put out? ---- */

  const artistResults = await mapLimited(topArtists, 3, async ([id, meta]) => ({
    meta,
    releases: await getArtistReleases(user, id),
  }));

  for (const { meta, releases } of artistResults) {
    for (const release of releases.slice(0, 60)) {
      add(release, `More from ${meta.name}`, 1.0 * meta.weight);
    }
  }

  /* ---- hop 2: what else came out on these labels? ---- */

  const labelResults = await mapLimited(topLabels, 3, async ([id, meta]) => ({
    meta,
    releases: await getLabelReleases(user, id),
  }));

  const seedArtistNames = new Set(
    seeds.flatMap((s) => s.artistNames.map((n) => n.toLowerCase())),
  );

  /** Labels the playlist's artists appear on that the playlist itself misses. */
  const adjacent = new Map<string, number>();

  for (const { meta, releases } of labelResults) {
    for (const release of releases.slice(0, 80)) {
      const byKnownArtist = seedArtistNames.has(release.artist.toLowerCase());
      add(
        release,
        byKnownArtist
          ? `${meta.name} — artist you already play`
          : `Labelmate on ${meta.name}`,
        (byKnownArtist ? 0.85 : 0.6) * meta.weight,
      );
    }
  }

  for (const { releases } of artistResults) {
    for (const release of releases) {
      if (!release.label) continue;
      if (params.profile.labels.some((l) => l.name === release.label)) continue;
      adjacent.set(release.label, (adjacent.get(release.label) ?? 0) + 1);
    }
  }

  /* ---- scoring adjustments ---- */

  for (const candidate of candidates.values()) {
    const { release } = candidate;

    // Era proximity. A playlist rooted in 1994 should not be answered with
    // 2023 reissue-adjacent house just because the label matches.
    if (yearRange && release.year) {
      const centre = (yearRange.from + yearRange.to) / 2;
      const spread = Math.max(6, (yearRange.to - yearRange.from) / 2 + 4);
      const distance = Math.abs(release.year - centre);
      const proximity = Math.max(0, 1 - distance / (spread * 2.5));
      candidate.score *= 0.7 + 0.3 * proximity;
      if (proximity > 0.8) candidate.signals.add("Same era");
    }

    // Multiple independent paths to the same record is the strongest signal
    // the graph produces — it means artist *and* label both point at it.
    if (candidate.signals.size > 1) candidate.score *= 1.25;

    if (wantlist.has(release.id)) {
      candidate.score *= 1.15;
      candidate.signals.add("Already on your wantlist");
    }
  }

  /* ---- rank, drop what is already owned, diversify ---- */

  const ranked = [...candidates.values()]
    .filter((c) => !owned.has(c.release.id))
    .sort((a, b) => b.score - a.score);

  // Cap how many entries any one artist contributes, so a prolific artist
  // cannot fill the whole panel.
  const perArtist = new Map<string, number>();
  const picked: Candidate[] = [];

  for (const candidate of ranked) {
    const key = candidate.release.artist.toLowerCase();
    const used = perArtist.get(key) ?? 0;
    if (used >= 3) continue;
    perArtist.set(key, used + 1);
    picked.push(candidate);
    if (picked.length >= limit) break;
  }

  const topScore = picked[0]?.score ?? 1;

  const recommendations: Recommendation[] = picked.map((candidate) => ({
    releaseId: candidate.release.id,
    title: candidate.release.title,
    artist: candidate.release.artist,
    year: candidate.release.year,
    labels: candidate.release.label ? [candidate.release.label] : [],
    styles: [...playlistStyles].slice(0, 0), // filled in by enrichment, if run
    thumb: candidate.release.thumb,
    score: Math.round((candidate.score / topScore) * 1000) / 1000,
    signals: [...candidate.signals],
    owned: false,
    inWantlist: wantlist.has(candidate.release.id),
    discogsUrl: `https://www.discogs.com/release/${candidate.release.id}`,
  }));

  const adjacentLabels: Weighted[] = [...adjacent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count, share: 0 }));

  return { recommendations, adjacentLabels };
}

/** Stable hash of a playlist's contents, for the analysis cache. */
export async function fingerprint(clipKeys: string[]): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(clipKeys.join("|")).digest("hex");
}
