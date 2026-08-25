"use client";

import { useMemo, useState } from "react";
import type { Playable } from "@/lib/types";
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
}

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
};

export type FacetKey =
  | "artists"
  | "genres"
  | "styles"
  | "labels"
  | "countries"
  | "formats"
  | "decades";

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
    }
  }

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
    minBpm: Number.isFinite(minBpm) ? Math.floor(minBpm) : 60,
    maxBpm: Number.isFinite(maxBpm) ? Math.ceil(maxBpm) : 200,
    bpmKnown,
  };
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
    if (sets.genres.size > 0 && !item.genres.some((g) => sets.genres.has(g))) return false;
    if (sets.styles.size > 0 && !item.styles.some((s) => sets.styles.has(s))) return false;
    if (sets.labels.size > 0 && !item.labels.some((l) => sets.labels.has(l))) return false;
    if (sets.formats.size > 0 && !item.formats.some((f) => sets.formats.has(f))) return false;

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
}: {
  label: string;
  options: Array<[string, number]>;
  selected: string[];
  onToggle: (value: string) => void;
  collapsedCount?: number;
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
        {selected.length > 0 && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
            {selected.length}
          </span>
        )}
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

function NumberRange({
  label,
  from,
  to,
  placeholderFrom,
  placeholderTo,
  onChange,
  step,
}: {
  label: string;
  from: number | null;
  to: number | null;
  placeholderFrom: number;
  placeholderTo: number;
  onChange: (from: number | null, to: number | null) => void;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        inputMode="numeric"
        step={step}
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
}: {
  facets: Facets;
  filters: FilterState;
  onChange: (next: FilterState) => void;
  matched: number;
  total: number;
  /** BPM of whatever is playing, for the "mixable with this" shortcut. */
  currentBpm: number | null;
}) {
  const toggle = (key: FacetKey) => (value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
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
            id="crate-search"
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
          placeholderFrom={facets.minBpm}
          placeholderTo={facets.maxBpm}
          onChange={(bpmFrom, bpmTo) => onChange({ ...filters, bpmFrom, bpmTo })}
        />

        <div className="mt-2 flex flex-wrap gap-1.5">
          {currentBpm !== null && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...filters,
                  bpmFrom: Math.round((currentBpm - 3) * 10) / 10,
                  bpmTo: Math.round((currentBpm + 3) * 10) / 10,
                })
              }
              className="rounded-full border border-accent/50 bg-accent/10 px-2 py-1 text-[11px] text-accent"
              title="Narrow the crate to what will mix with what's playing"
            >
              Mixable with {currentBpm} (±3)
            </button>
          )}
          {(
            [
              ["Downtempo", 60, 100],
              ["House", 118, 128],
              ["Techno", 128, 145],
              ["Jungle / DnB", 160, 180],
            ] as const
          ).map(([name, low, high]) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange({ ...filters, bpmFrom: low, bpmTo: high })}
              className="rounded-full border border-ink-700 bg-ink-850 px-2 py-1 text-[11px] text-neutral-400 hover:border-ink-600 hover:text-neutral-200"
            >
              {name}
            </button>
          ))}
        </div>

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
      <ChipGroup label="Style" options={facets.styles} selected={filters.styles} onToggle={toggle("styles")} />
      <ChipGroup label="Genre" options={facets.genres} selected={filters.genres} onToggle={toggle("genres")} collapsedCount={8} />
      <ChipGroup label="Label" options={facets.labels} selected={filters.labels} onToggle={toggle("labels")} collapsedCount={8} />
      <ChipGroup label="Artist" options={facets.artists} selected={filters.artists} onToggle={toggle("artists")} collapsedCount={8} />
      <ChipGroup label="Format" options={facets.formats} selected={filters.formats} onToggle={toggle("formats")} collapsedCount={8} />
      <ChipGroup label="Country" options={facets.countries} selected={filters.countries} onToggle={toggle("countries")} collapsedCount={8} />
    </div>
  );
}
