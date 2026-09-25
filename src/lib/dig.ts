import "server-only";
import {
  DiscogsError,
  getArtistReleases,
  getLabelReleases,
  getMasterVersions,
  getReleaseLinks,
  searchReleases,
  type RelatedRelease,
  type SearchHit,
} from "./discogs";
import { DIG_LANE_LABELS, type DigLane, type DigResult } from "./types";
import { pickCredits, roleWord, versionReason, type MasterVersion } from "./digLinks";

/**
 * Off-the-cuff digging from a single record.
 *
 * This is the "I'm listening to something and I want to fall down a hole"
 * path, as opposed to the playlist-level recommender in `recommend.ts`. The
 * difference matters:
 *
 *   recommend.ts  — profiles a whole playlist, runs once, caches, may involve
 *                   an LLM ranking pass. Deliberate and slow.
 *   dig.ts        — one seed release, four cheap parallel lookups, no LLM,
 *                   answers in about a second. Meant to be hammered.
 *
 * Every result is a real Discogs release id reached by a real relationship,
 * and each carries the lane that produced it so the UI never has to say
 * "recommended" without saying why.
 */

interface UserToken {
  token: string;
  tokenSecret: string;
}

export interface DigSeed {
  releaseId: number;
  artistIds: number[];
  artistNames: string[];
  labelIds: number[];
  labelNames: string[];
  styles: string[];
  genres: string[];
  year: number | null;
  country: string | null;
}

const marketplaceUrl = (id: number) =>
  `https://www.discogs.com/sell/release/${id}`;
const releaseUrl = (id: number) => `https://www.discogs.com/release/${id}`;

function fromRelated(
  row: RelatedRelease,
  lane: DigLane,
  reason: string,
): DigResult {
  return {
    releaseId: row.id,
    title: row.title,
    artist: row.artist,
    year: row.year,
    thumb: row.thumb,
    labels: row.label ? [row.label] : [],
    styles: [],
    genres: [],
    country: null,
    lane,
    reason,
    have: null,
    want: null,
    discogsUrl: releaseUrl(row.id),
    marketplaceUrl: marketplaceUrl(row.id),
  };
}

function fromHit(hit: SearchHit, lane: DigLane, reason: string): DigResult {
  return {
    releaseId: hit.id,
    title: hit.title,
    artist: hit.artist,
    year: hit.year,
    thumb: hit.thumb,
    labels: hit.labels,
    styles: hit.styles,
    genres: hit.genres,
    country: hit.country,
    lane,
    reason,
    have: hit.have,
    want: hit.want,
    discogsUrl: releaseUrl(hit.id),
    marketplaceUrl: marketplaceUrl(hit.id),
  };
}

function fromVersion(version: MasterVersion, artist: string): DigResult {
  return {
    releaseId: version.id,
    title: version.title,
    artist,
    year: version.released ? Number(version.released.match(/\d{4}/)?.[0]) || null : null,
    thumb: version.thumb,
    labels: version.label ? [version.label] : [],
    styles: [],
    genres: [],
    country: version.country,
    lane: "other-versions",
    reason: versionReason(version),
    have: null,
    want: null,
    discogsUrl: releaseUrl(version.id),
    marketplaceUrl: marketplaceUrl(version.id),
  };
}

/** Never let one lookup failure sink the whole dig. */
async function attempt<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DiscogsError && error.status === 429) throw error;
    console.warn("[dig] lane failed", error);
    return fallback;
  }
}

export interface DigOptions {
  user: UserToken;
  seed: DigSeed;
  /** Release ids to exclude — usually the collection, optionally the wantlist. */
  exclude: Set<number>;
  /** Ids already shown in this session, so the feed keeps moving. */
  seen: Set<number>;
  perLane?: number;
  /**
   * Which page of each upstream lookup to read. "Dig deeper" walks forward
   * through the artist's discography, the label's catalogue and the style
   * search instead of re-reading page one and filtering it down to nothing.
   */
  page?: number;
}

export async function digFromRelease(options: DigOptions): Promise<
  Array<{ lane: DigLane; label: string; results: DigResult[] }>
> {
  const { user, seed, exclude, seen } = options;
  const page = options.page ?? 1;
  const perLane = options.perLane ?? 12;

  /*
   * Step one: the seed's own links — master, credits, and its artists and
   * labels by id. A seed that came from a search card (digging from a record
   * you do not own) arrives without artist or label ids; these fill them in,
   * so every seed gets every lane, not just style and era.
   */
  const links = await attempt(() => getReleaseLinks(user, seed.releaseId), {
    masterId: null,
    artists: [],
    labels: [],
    credits: [],
  });

  const artistIds = seed.artistIds.length > 0 ? seed.artistIds : links.artists.map((a) => a.id);
  const labelIds = seed.labelIds.length > 0 ? seed.labelIds : links.labels.map((l) => l.id);
  const primaryArtist = artistIds[0];
  const primaryLabel = labelIds[0];
  const primaryStyle = seed.styles[0] ?? seed.genres[0];

  // Era window. Wide enough to be interesting, narrow enough to stay in the
  // same world as the record that prompted the dig.
  const eraRange = seed.year
    ? `${Math.max(1900, seed.year - 3)}-${Math.min(new Date().getFullYear(), seed.year + 3)}`
    : undefined;

  /*
   * The first credit worth following — usually the remixer. One per dig
   * keeps a dig at seven upstream calls; "dig deeper" pages through the same
   * credit, and digging from one of their records moves on to that record's
   * credits.
   */
  const credit =
    pickCredits(links.credits, [...artistIds, ...links.artists.map((a) => a.id)], 1)[0] ?? null;

  // Step two: six lookups in parallel.
  const [artistRows, labelRows, styleHits, eraHits, versions, creditRows] = await Promise.all([
    primaryArtist
      ? attempt(() => getArtistReleases(user, primaryArtist, 60, page), [])
      : Promise.resolve([]),

    primaryLabel
      ? attempt(() => getLabelReleases(user, primaryLabel, 80, page), [])
      : Promise.resolve([]),

    primaryStyle
      ? attempt(
          () =>
            searchReleases(user, {
              style: seed.styles[0],
              genre: seed.styles[0] ? undefined : seed.genres[0],
              perPage: 60,
              page,
            }),
          [],
        )
      : Promise.resolve([]),

    primaryStyle && eraRange
      ? attempt(
          () =>
            searchReleases(user, {
              style: seed.styles[0],
              genre: seed.styles[0] ? undefined : seed.genres[0],
              year: eraRange,
              country: seed.country ?? undefined,
              perPage: 60,
              page,
            }),
          [],
        )
      : Promise.resolve([]),

    links.masterId
      ? attempt(() => getMasterVersions(user, links.masterId as number, 50, page), [])
      : Promise.resolve([]),

    credit
      ? attempt(() => getArtistReleases(user, credit.id, 60, page, "credits"), [])
      : Promise.resolve([]),
  ]);

  const artistName = seed.artistNames[0] ?? links.artists[0]?.name ?? "this artist";
  const labelName = seed.labelNames[0] ?? links.labels[0]?.name ?? "this label";
  const styleName = seed.styles[0] ?? seed.genres[0] ?? "this style";

  const lanes: Array<{ lane: DigLane; label?: string; results: DigResult[] }> = [
    {
      lane: "other-versions",
      results: versions.map((version) => fromVersion(version, artistName)),
    },
    {
      lane: "credits",
      label: credit ? `Credits · ${credit.name}, ${roleWord(credit.role)}` : undefined,
      results: creditRows.map((row) =>
        fromRelated(
          row,
          "credits",
          credit ? `${credit.name} — ${roleWord(credit.role)} on the record you dug from` : "Credited on this record",
        ),
      ),
    },
    {
      lane: "same-artist",
      results: artistRows.map((row) =>
        fromRelated(row, "same-artist", `${artistName} — another release`),
      ),
    },
    {
      lane: "same-label",
      results: labelRows.map((row) =>
        fromRelated(row, "same-label", `Also on ${labelName}`),
      ),
    },
    {
      lane: "same-style",
      results: styleHits.map((hit) =>
        fromHit(hit, "same-style", `${styleName}, sorted by how wanted it is`),
      ),
    },
    {
      lane: "same-era",
      results: eraHits.map((hit) =>
        fromHit(
          hit,
          "same-era",
          seed.year
            ? `${styleName} from ${seed.year - 3}–${seed.year + 3}`
            : `${styleName}, same period`,
        ),
      ),
    },
  ];

  /* ---- de-duplicate across lanes, drop the seed, drop what is excluded ---- */

  const claimed = new Set<number>([seed.releaseId]);

  return lanes
    .map(({ lane, label, results }) => {
      const kept: DigResult[] = [];

      for (const result of results) {
        if (claimed.has(result.releaseId)) continue;
        if (exclude.has(result.releaseId)) continue;
        // Already shown this session: skip, so "dig again" actually moves.
        if (seen.has(result.releaseId)) continue;

        claimed.add(result.releaseId);
        kept.push(result);
        if (kept.length >= perLane) break;
      }

      // Within a lane, put the records people actually want first. `want` is
      // null for the artist/label lanes (Discogs omits it there), and those
      // keep their upstream order, which is chronological.
      kept.sort((a, b) => (b.want ?? 0) - (a.want ?? 0));

      return { lane, label: label ?? DIG_LANE_LABELS[lane], results: kept };
    })
    .filter((lane) => lane.results.length > 0);
}

/**
 * The in-collection half of digging: no network at all.
 *
 * Everything here is computed from the browser's own cache on the client
 * (see client/digLocal.ts). This function exists only to document that the
 * split is deliberate — pivoting inside your own crate should be instant, and
 * spending a Discogs request to tell someone what they already own would be
 * absurd.
 */
export const IN_COLLECTION_DIGGING_IS_CLIENT_SIDE = true;
