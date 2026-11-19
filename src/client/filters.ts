/**
 * The crate's filters — the state, the facets counted from the crate, and the
 * function that applies them. Pure, so the tests can import it without a
 * React component in the way; the panel that edits it is components/Filters.tsx.
 */

import type { Playable } from "@/lib/types";
import { BPM_CEILING, BPM_FLOOR, BPM_HARD_MAX, BPM_HARD_MIN } from "@/lib/filterBounds";
import { tagHaystack } from "@/lib/tags";
import { inFolders } from "@/client/folders";

/*
 * Faceted filtering.
 *
 * Every option in the panel is derived from the collection that was actually
 * synced from Discogs — `computeFacets` walks the playable pool and counts
 * real values. There is no hardcoded genre list anywhere in this file. The
 * number beside each chip is how many clips in *your* crate carry that tag,
 * and the facets re-rank as the sync fills in.
 */

export interface FilterState {
  query: string;
  /** Your own tags (lib/tags.ts). */
  tags: string[];
  /**
   * Discogs collection folders, by name (client/folders.ts). With `hideFolders`
   * off, only records with a copy in any of these; on, every record except
   * the ones filed nowhere else — the "don't shuffle my listening albums"
   * switch.
   */
  folders: string[];
  hideFolders: boolean;
  artists: string[];
  genres: string[];
  styles: string[];
  labels: string[];
  countries: string[];
  formats: string[];
  decades: string[];
  yearFrom: number | null;
  yearTo: number | null;
  bpmFrom: number | null;
  bpmTo: number | null;
  tracksOnly: boolean;
  withBpmOnly: boolean;
  /*
   * Whether a facet with several values selected means "any of these" or "all
   * of these".
   *
   * Every facet was OR-within, AND-across: pick Techno and Deep House and you
   * get records tagged either way, and there was no way to ask for the ones
   * tagged *both*. Both questions are worth asking and they find different
   * records — "any" widens the crate, "all" finds the specific corner where
   * two tags overlap, which on a well-tagged collection is often the most
   * interesting shelf in it.
   *
   * Only the genuinely multi-valued facets appear here. A release has one
   * artist string, one country and one decade in this model, so "all" would
   * always be empty for those and the control is not offered.
   */
  matchAll: Partial<Record<MultiFacetKey, boolean>>;
}

/** Facets where a release can carry more than one value at once. */
export type MultiFacetKey = "tags" | "genres" | "styles" | "labels" | "formats";

export const MULTI_FACETS: readonly MultiFacetKey[] = [
  "tags",
  "genres",
  "styles",
  "labels",
  "formats",
];

export const emptyFilters: FilterState = {
  query: "",
  tags: [],
  folders: [],
  hideFolders: false,
  artists: [],
  genres: [],
  styles: [],
  labels: [],
  countries: [],
  formats: [],
  decades: [],
  yearFrom: null,
  yearTo: null,
  bpmFrom: null,
  bpmTo: null,
  tracksOnly: false,
  withBpmOnly: false,
  matchAll: {},
};

/**
 * The Folder chips worth showing. Most collections sit entirely in
 * "Uncategorized", and one chip is a question with one answer — so with a
 * single folder across the crate there is no group at all. A ticked folder
 * always shows, whatever the crate holds now, so it can be unticked.
 */
export function folderChoices(
  options: Array<[string, number]>,
  selected: readonly string[],
): Array<[string, number]> {
  return options.length > 1 || selected.length > 0 ? options : [];
}

/**
 * Tick or untick one folder. With none left the switch goes back to "only":
 * "hide" with nothing to hide is not a state the panel can show, and it would
 * otherwise sit in the filters as a difference from empty that nothing on
 * screen explains — and come back as "hide" on the next folder you tick.
 */
export function toggleFolder(filters: FilterState, name: string): FilterState {
  const folders = filters.folders.includes(name)
    ? filters.folders.filter((f) => f !== name)
    : [...filters.folders, name];
  return { ...filters, folders, hideFolders: folders.length > 0 && filters.hideFolders };
}

/**
 * A pivot — a chip in Dig, a tag picked from the player: the crate filtered
 * to that one value and nothing else. Except the Folder choice, which is a
 * standing one and not a filter of the moment: a pivot that dropped it would
 * also erase it from the device, and "don't play my listening albums" would
 * end the first time a style chip was tapped. A pivot onto a folder itself
 * shows only that folder.
 */
export function pivotTo(current: FilterState, facet: FacetKey, value: string): FilterState {
  if (facet === "folders") return { ...emptyFilters, folders: [value], hideFolders: false };
  return { ...emptyFilters, folders: current.folders, hideFolders: current.hideFolders, [facet]: [value] };
}

export type FacetKey =
  | "tags"
  | "folders"
  | "artists"
  | "genres"
  | "styles"
  | "labels"
  | "countries"
  | "formats"
  | "decades";

/** A tempo band measured from the user's own catalogue, per style. */
export interface StyleTempo {
  style: string;
  low: number;
  high: number;
  median: number;
  count: number;
}

export interface Facets {
  /** Your tags in this crate, most-used first. */
  tags: Array<[string, number]>;
  /** Your Discogs folders, by how many tracks sit in each; empty until read. */
  folders: Array<[string, number]>;
  artists: Array<[string, number]>;
  genres: Array<[string, number]>;
  styles: Array<[string, number]>;
  labels: Array<[string, number]>;
  countries: Array<[string, number]>;
  formats: Array<[string, number]>;
  decades: Array<[string, number]>;
  minYear: number;
  maxYear: number;
  minBpm: number;
  maxBpm: number;
  bpmKnown: number;
  /**
   * Tempo presets derived from the collection itself: for each style with
   * enough catalogued BPMs, the 10th–90th percentile of what that style
   * actually runs at *in this crate*. This is what replaces the hardcoded
   * "House 118–128" guesses — your Detroit techno might sit at 132–138 and
   * the chip will say so.
   */
  styleTempos: StyleTempo[];
}

/** Count every facet value across the pool so the UI can rank by frequency. */
export function computeFacets(pool: Playable[]): Facets {
  const counters: Record<FacetKey, Map<string, number>> = {
    tags: new Map(),
    folders: new Map(),
    artists: new Map(),
    genres: new Map(),
    styles: new Map(),
    labels: new Map(),
    countries: new Map(),
    formats: new Map(),
    decades: new Map(),
  };

  let minYear = Infinity;
  let maxYear = -Infinity;
  let minBpm = Infinity;
  let maxBpm = -Infinity;
  let bpmKnown = 0;

  /** style -> every catalogued BPM for that style in this crate */
  const tempoByStyle = new Map<string, number[]>();

  const bump = (key: FacetKey, value: string) => {
    if (!value) return;
    const map = counters[key];
    map.set(value, (map.get(value) ?? 0) + 1);
  };

  for (const item of pool) {
    for (const t of item.tags ?? []) bump("tags", t);
    for (const f of item.folders ?? []) bump("folders", f);
    bump("artists", item.artist);
    for (const g of item.genres) bump("genres", g);
    for (const s of item.styles) bump("styles", s);
    for (const l of item.labels) bump("labels", l);
    if (item.country) bump("countries", item.country);
    for (const f of item.formats) bump("formats", f);

    if (item.year) {
      bump("decades", `${Math.floor(item.year / 10) * 10}s`);
      minYear = Math.min(minYear, item.year);
      maxYear = Math.max(maxYear, item.year);
    }

    if (item.bpm !== null) {
      bpmKnown += 1;
      minBpm = Math.min(minBpm, item.bpm);
      maxBpm = Math.max(maxBpm, item.bpm);

      for (const style of item.styles) {
        const list = tempoByStyle.get(style);
        if (list) list.push(item.bpm);
        else tempoByStyle.set(style, [item.bpm]);
      }
    }
  }

  /* ---- tempo bands per style, from real readings ---- */

  const percentile = (sorted: number[], p: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]!;

  const styleTempos: StyleTempo[] = [...tempoByStyle.entries()]
    // Four readings is the minimum before a band means anything.
    .filter(([, values]) => values.length >= 4)
    .map(([style, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const low = Math.floor(percentile(sorted, 0.1));
      const high = Math.ceil(percentile(sorted, 0.9));
      // A zero-width band ("128–128") is technically accurate and practically
      // useless as a filter — nothing else would ever fall inside it. Open it
      // up to a mixable window instead.
      const pad = high - low < 4 ? 2 : 0;
      return {
        style,
        low: Math.max(BPM_HARD_MIN, low - pad),
        high: Math.min(BPM_HARD_MAX, high + pad),
        median: Math.round(percentile(sorted, 0.5)),
        count: values.length,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const rank = (m: Map<string, number>, cap = 400) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, cap);

  // Decades read better chronologically than by frequency.
  const decades = [...counters.decades.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  return {
    tags: rank(counters.tags),
    folders: rank(counters.folders, 60),
    artists: rank(counters.artists),
    genres: rank(counters.genres),
    styles: rank(counters.styles),
    labels: rank(counters.labels),
    countries: rank(counters.countries, 60),
    formats: rank(counters.formats, 40),
    decades,
    minYear: Number.isFinite(minYear) ? minYear : 1950,
    maxYear: Number.isFinite(maxYear) ? maxYear : new Date().getFullYear(),
    minBpm: Number.isFinite(minBpm) ? Math.floor(minBpm) : BPM_FLOOR,
    maxBpm: Number.isFinite(maxBpm) ? Math.ceil(maxBpm) : BPM_CEILING,
    bpmKnown,
    styleTempos,
  };
}

/** Does one record satisfy one multi-valued facet selection? */
function facetMatches(
  values: readonly string[],
  selected: Set<string>,
  all: boolean | undefined,
): boolean {
  if (selected.size === 0) return true;
  if (all) {
    for (const wanted of selected) {
      if (!values.includes(wanted)) return false;
    }
    return true;
  }
  return values.some((value) => selected.has(value));
}

export function applyFilters(
  pool: Playable[],
  filters: FilterState,
): Playable[] {
  const needle = filters.query.trim().toLowerCase();

  const sets: Record<FacetKey, Set<string>> = {
    tags: new Set(filters.tags),
    folders: new Set(filters.folders),
    artists: new Set(filters.artists),
    genres: new Set(filters.genres),
    styles: new Set(filters.styles),
    labels: new Set(filters.labels),
    countries: new Set(filters.countries),
    formats: new Set(filters.formats),
    decades: new Set(filters.decades),
  };

  return pool.filter((item) => {
    if (filters.tracksOnly && item.matchKind !== "track") return false;
    if (filters.withBpmOnly && item.bpm === null) return false;

    if (filters.yearFrom !== null && (item.year ?? 0) < filters.yearFrom) return false;
    if (filters.yearTo !== null && (item.year ?? 9999) > filters.yearTo) return false;

    if (filters.bpmFrom !== null || filters.bpmTo !== null) {
      if (item.bpm === null) return false;
      if (filters.bpmFrom !== null && item.bpm < filters.bpmFrom) return false;
      if (filters.bpmTo !== null && item.bpm > filters.bpmTo) return false;
    }

    if (!facetMatches(item.tags ?? [], sets.tags, filters.matchAll?.tags)) return false;
    // Only, or everything but; a record whose folders aren't known passes.
    if (!inFolders(item, sets.folders, filters.hideFolders)) return false;
    if (sets.artists.size > 0 && !sets.artists.has(item.artist)) return false;
    /*
     * "any" is satisfied when the record carries at least one of the selected
     * values; "all" when it carries every one of them. Note the direction of
     * the "all" test: it asks whether each *selected* value is present on the
     * record, not whether each of the record's tags was selected — a record
     * tagged Techno, Deep House and Detroit still matches "Techno AND Deep
     * House". Getting that backwards would make "all" mean "exactly these",
     * which almost nobody wants and which returns nothing on real data.
     */
    if (!facetMatches(item.genres, sets.genres, filters.matchAll?.genres)) return false;
    if (!facetMatches(item.styles, sets.styles, filters.matchAll?.styles)) return false;
    if (!facetMatches(item.labels, sets.labels, filters.matchAll?.labels)) return false;
    if (!facetMatches(item.formats, sets.formats, filters.matchAll?.formats)) return false;

    if (sets.countries.size > 0) {
      if (!item.country || !sets.countries.has(item.country)) return false;
    }

    if (sets.decades.size > 0) {
      if (!item.year) return false;
      if (!sets.decades.has(`${Math.floor(item.year / 10) * 10}s`)) return false;
    }

    if (needle) {
      // Your tags as "#deep": typing deep finds them along with titles, and
      // typing #deep finds only them.
      const haystack =
        `${item.title} ${item.artist} ${item.releaseTitle} ${item.labels.join(" ")} ${tagHaystack(item.tags)}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}
