"use client";

import { useMemo, useState } from "react";
import type { Playable } from "@/lib/types";
import { DEFAULT_PITCH_PERCENT, mixableWindow } from "@/lib/mixing";
import { Search } from "./Icons";

/**
 * Faceted filtering.
 *
 * Every option in this panel is derived from the collection that was actually
 * synced from Discogs — `computeFacets` walks the playable pool and counts
 * real values. There is no hardcoded genre list anywhere in this file. The
 * number beside each chip is how many clips in *your* crate carry that tag,
 * and the facets re-rank as the sync fills in.
 */

export interface FilterState {
  query: string;
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
export type MultiFacetKey = "genres" | "styles" | "labels" | "formats";

export const MULTI_FACETS: readonly MultiFacetKey[] = [
  "genres",
  "styles",
  "labels",
  "formats",
];

export const emptyFilters: FilterState = {
  query: "",
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

export type FacetKey =
  | "artists"
  | "genres"
  | "styles"
  | "labels"
  | "countries"
  | "formats"
  | "decades";

/**
 * Default tempo window. 75–180 covers everything from hip hop and downtempo
 * up through jungle, and is the range the two scaling buttons work outward
 * from. It is a *default*, not a limit — the inputs accept 40–260 so a
 * dubstep or drone crate is not artificially fenced in.
 */
export const BPM_FLOOR = 75;
export const BPM_CEILING = 180;
export const BPM_HARD_MIN = 40;
export const BPM_HARD_MAX = 260;

/** A tempo band measured from the user's own catalogue, per style. */
export interface StyleTempo {
  style: string;
  low: number;
  high: number;
  median: number;
  count: number;
}

export interface Facets {
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
      const haystack =
        `${item.title} ${item.artist} ${item.releaseTitle} ${item.labels.join(" ")}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }

    return true;
  });
}

/* ------------------------------------------------------------------ */

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  collapsedCount = 10,
  matchAll,
  onMatchAllChange,
}: {
  label: string;
  options: Array<[string, number]>;
  selected: string[];
  onToggle: (value: string) => void;
  collapsedCount?: number;
  /** Undefined for facets where a record can only hold one value. */
  matchAll?: boolean;
  onMatchAllChange?: (all: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? options.filter(([name]) => name.toLowerCase().includes(needle))
      : options;
    return expanded || needle
      ? filtered.slice(0, 300)
      : filtered.slice(0, collapsedCount);
  }, [options, search, expanded, collapsedCount]);

  if (options.length === 0) return null;

  return (
    <section className="border-t border-ink-800 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </h3>
        <div className="flex items-center gap-1.5">
          {/*
            any / all, and only once there are two things selected — with one
            value the distinction does not exist, and a control that is inert
            most of the time teaches people to ignore it.
          */}
          {onMatchAllChange && selected.length > 1 && (
            <div
              className="flex overflow-hidden rounded border border-ink-700"
              role="group"
              aria-label={`${label} match mode`}
            >
              {([false, true] as const).map((all) => (
                <button
                  key={String(all)}
                  type="button"
                  onClick={() => onMatchAllChange(all)}
                  aria-pressed={Boolean(matchAll) === all}
                  title={
                    all
                      ? `Records tagged with every selected ${label.toLowerCase()}`
                      : `Records tagged with any selected ${label.toLowerCase()}`
                  }
                  className={`px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors ${
                    Boolean(matchAll) === all
                      ? "bg-accent/20 text-accent"
                      : "text-neutral-600 hover:text-neutral-300"
                  }`}
                >
                  {all ? "all" : "any"}
                </button>
              ))}
            </div>
          )}

          {selected.length > 0 && (
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
              {selected.length}
            </span>
          )}
        </div>
      </div>

      {options.length > collapsedCount && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Filter ${label.toLowerCase()}…`}
          className="mb-2 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs placeholder:text-neutral-600"
          aria-label={`Search ${label}`}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        {visible.map(([name, count]) => {
          const active = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-pressed={active}
              className={`max-w-full truncate rounded-full border px-2 py-1 text-[11px] transition-colors ${
                active
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-ink-700 bg-ink-850 text-neutral-400 hover:border-ink-600 hover:text-neutral-200"
              }`}
            >
              {name}
              <span className="ml-1 text-neutral-600">{count}</span>
            </button>
          );
        })}
      </div>

      {options.length > collapsedCount && !search && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${options.length}`}
        </button>
      )}
    </section>
  );
}

/**
 * Halve or double the active tempo window, clamped to the sane outer bounds.
 * With no window set, scaling starts from the default one rather than doing
 * nothing — which is what a DJ pressing ×2 actually expects to happen.
 */
function scaleRange(
  filters: FilterState,
  factor: 0.5 | 2,
): Pick<FilterState, "bpmFrom" | "bpmTo"> {
  const from = filters.bpmFrom ?? BPM_FLOOR;
  const to = filters.bpmTo ?? BPM_CEILING;

  return {
    bpmFrom: Math.max(BPM_HARD_MIN, Math.round(from * factor * 10) / 10),
    bpmTo: Math.min(BPM_HARD_MAX, Math.round(to * factor * 10) / 10),
  };
}

function NumberRange({
  label,
  from,
  to,
  placeholderFrom,
  placeholderTo,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  from: number | null;
  to: number | null;
  placeholderFrom: number;
  placeholderTo: number;
  onChange: (from: number | null, to: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        step={step}
        min={min}
        max={max}
        value={from ?? ""}
        placeholder={String(placeholderFrom)}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null, to)}
        className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs"
        aria-label={`${label} from`}
      />
      <span className="text-neutral-600">–</span>
      <input
        type="number"
        inputMode="numeric"
        step={step}
        min={min}
        max={max}
        value={to ?? ""}
        placeholder={String(placeholderTo)}
        onChange={(e) => onChange(from, e.target.value ? Number(e.target.value) : null)}
        className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs"
        aria-label={`${label} to`}
      />
    </div>
  );
}

export function Filters({
  facets,
  filters,
  onChange,
  matched,
  total,
  currentBpm,
  pitchPercent = DEFAULT_PITCH_PERCENT,
}: {
  facets: Facets;
  filters: FilterState;
  onChange: (next: FilterState) => void;
  matched: number;
  total: number;
  /** BPM of whatever is playing, for the "mixable with this" shortcut. */
  currentBpm: number | null;
  /** Deck pitch range. Decides how wide "mixable" actually is. */
  pitchPercent?: number;
}) {
  // Not bpm ± n. A pitch fader is a percentage and both decks have one, so the
  // window is asymmetric and wider than it looks. See lib/mixing.ts.
  const window = currentBpm !== null ? mixableWindow(currentBpm, pitchPercent) : null;
  const toggle = (key: FacetKey) => (value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  };

  const setMatchAll = (key: MultiFacetKey) => (all: boolean) => {
    onChange({
      ...filters,
      matchAll: { ...filters.matchAll, [key]: all },
    });
  };

  const dirty = useMemo(
    () =>
      JSON.stringify({ ...filters, query: filters.query.trim() }) !==
      JSON.stringify(emptyFilters),
    [filters],
  );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 bg-ink-900/95 px-4 py-3 backdrop-blur">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            id="dig-search"
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search artist, track, label…"
            className="w-full rounded-md border border-ink-700 bg-ink-850 py-1.5 pl-8 pr-2 text-sm placeholder:text-neutral-600"
            aria-label="Search the crate"
          />
        </label>

        <div className="mt-2 flex items-baseline justify-between text-[11px]">
          <span className="text-neutral-500">
            <span className="font-semibold text-neutral-300">
              {matched.toLocaleString()}
            </span>
            {" of "}
            {total.toLocaleString()} clips
          </span>
          {dirty && (
            <button
              type="button"
              onClick={() => onChange(emptyFilters)}
              className="text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Tempo */}
      <section className="border-t border-ink-800 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            Tempo
          </h3>
          <span className="text-[10px] text-neutral-600">
            {facets.bpmKnown.toLocaleString()} known
          </span>
        </div>

        <NumberRange
          label="BPM"
          from={filters.bpmFrom}
          to={filters.bpmTo}
          placeholderFrom={BPM_FLOOR}
          placeholderTo={BPM_CEILING}
          min={BPM_HARD_MIN}
          max={BPM_HARD_MAX}
          onChange={(bpmFrom, bpmTo) => onChange({ ...filters, bpmFrom, bpmTo })}
        />

        {/*
          Half-time / double-time. A 140 record sits in a 70 set and a 87 read
          of a jungle track is the same record as 174 — so the range itself
          needs to halve and double, not just individual readings.
        */}
        <div className="mt-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange({ ...filters, ...scaleRange(filters, 0.5) })}
            className="flex-1 rounded border border-ink-700 py-1 font-mono text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title="Halve the range — find the half-time versions"
          >
            ÷2
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, ...scaleRange(filters, 2) })}
            className="flex-1 rounded border border-ink-700 py-1 font-mono text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title="Double the range — find the double-time versions"
          >
            ×2
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, bpmFrom: BPM_FLOOR, bpmTo: BPM_CEILING })}
            className="flex-[2] rounded border border-ink-700 py-1 text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title={`Back to the default ${BPM_FLOOR}–${BPM_CEILING} window`}
          >
            {BPM_FLOOR}–{BPM_CEILING}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, bpmFrom: null, bpmTo: null })}
            className="flex-1 rounded border border-ink-700 py-1 text-[10px] text-neutral-500 hover:border-ink-600 hover:text-neutral-100"
            title="No tempo constraint"
          >
            any
          </button>
        </div>

        {currentBpm !== null && window && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...filters, bpmFrom: window.low, bpmTo: window.high })
            }
            className="mt-2 w-full rounded-full border border-accent/50 bg-accent/10 px-2 py-1 text-[11px] text-accent"
            title={`Both decks at ±${pitchPercent}% can meet anywhere from ${window.low} to ${window.high}`}
          >
            Mixes with {currentBpm}
            <span className="ml-1 font-mono text-accent/70">
              {window.low}–{window.high}
            </span>
          </button>
        )}

        {/*
          Tempo presets measured from this collection, not guessed. Each chip
          is the 10th–90th percentile of what that style actually runs at here.
        */}
        {facets.styleTempos.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] text-neutral-600">
              Measured from your own BPM catalogue
            </p>
            <div className="flex flex-wrap gap-1.5">
              {facets.styleTempos.map((band) => {
                const active =
                  filters.bpmFrom === band.low && filters.bpmTo === band.high;
                return (
                  <button
                    key={band.style}
                    type="button"
                    onClick={() =>
                      onChange({ ...filters, bpmFrom: band.low, bpmTo: band.high })
                    }
                    aria-pressed={active}
                    className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                      active
                        ? "border-accent/60 bg-accent/15 text-accent"
                        : "border-ink-700 bg-ink-850 text-neutral-400 hover:border-ink-600 hover:text-neutral-200"
                    }`}
                    title={`${band.count} catalogued clips, median ${band.median} BPM`}
                  >
                    {band.style}
                    <span className="ml-1 font-mono text-neutral-600">
                      {band.low}–{band.high}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {facets.bpmKnown === 0 && (
          <p className="mt-2 text-[10px] leading-relaxed text-neutral-600">
            No tempos catalogued yet. Hit <kbd className="rounded bg-ink-800 px-1">T</kbd>{" "}
            in time while something plays, or turn on auto-detect in the player.
            Style bands appear here once there are a few readings.
          </p>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={filters.withBpmOnly}
            onChange={(e) => onChange({ ...filters, withBpmOnly: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-850 accent-accent"
          />
          Only clips with a known BPM
        </label>
      </section>

      {/* Year */}
      <section className="border-t border-ink-800 px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Year
        </h3>
        <NumberRange
          label="Year"
          from={filters.yearFrom}
          to={filters.yearTo}
          placeholderFrom={facets.minYear}
          placeholderTo={facets.maxYear}
          onChange={(yearFrom, yearTo) => onChange({ ...filters, yearFrom, yearTo })}
        />

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={filters.tracksOnly}
            onChange={(e) => onChange({ ...filters, tracksOnly: e.target.checked })}
            className="h-3.5 w-3.5 rounded border-ink-600 bg-ink-850 accent-accent"
          />
          Only clips matched to a single track
        </label>
      </section>

      <ChipGroup label="Decade" options={facets.decades} selected={filters.decades} onToggle={toggle("decades")} collapsedCount={12} />
      <ChipGroup label="Style" options={facets.styles} selected={filters.styles} onToggle={toggle("styles")} matchAll={filters.matchAll?.styles ?? false} onMatchAllChange={setMatchAll("styles")} />
      <ChipGroup label="Genre" options={facets.genres} selected={filters.genres} onToggle={toggle("genres")} matchAll={filters.matchAll?.genres ?? false} onMatchAllChange={setMatchAll("genres")} collapsedCount={8} />
      <ChipGroup label="Label" options={facets.labels} selected={filters.labels} onToggle={toggle("labels")} matchAll={filters.matchAll?.labels ?? false} onMatchAllChange={setMatchAll("labels")} collapsedCount={8} />
      <ChipGroup label="Artist" options={facets.artists} selected={filters.artists} onToggle={toggle("artists")} collapsedCount={8} />
      <ChipGroup label="Format" options={facets.formats} selected={filters.formats} onToggle={toggle("formats")} matchAll={filters.matchAll?.formats ?? false} onMatchAllChange={setMatchAll("formats")} collapsedCount={8} />
      <ChipGroup label="Country" options={facets.countries} selected={filters.countries} onToggle={toggle("countries")} collapsedCount={8} />
    </div>
  );
}
