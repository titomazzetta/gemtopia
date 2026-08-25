"use client";

import { useMemo, useState } from "react";
import type { Playable } from "@/lib/types";
import { Search } from "./Icons";

export interface FilterState {
  query: string;
  genres: string[];
  styles: string[];
  labels: string[];
  yearFrom: number | null;
  yearTo: number | null;
  tracksOnly: boolean;
}

export const emptyFilters: FilterState = {
  query: "",
  genres: [],
  styles: [],
  labels: [],
  yearFrom: null,
  yearTo: null,
  tracksOnly: false,
};

export interface Facets {
  genres: Array<[string, number]>;
  styles: Array<[string, number]>;
  labels: Array<[string, number]>;
  minYear: number;
  maxYear: number;
}

/** Count every facet value across the pool so the UI can rank by frequency. */
export function computeFacets(pool: Playable[]): Facets {
  const genres = new Map<string, number>();
  const styles = new Map<string, number>();
  const labels = new Map<string, number>();
  let minYear = Infinity;
  let maxYear = -Infinity;

  for (const item of pool) {
    for (const g of item.genres) genres.set(g, (genres.get(g) ?? 0) + 1);
    for (const s of item.styles) styles.set(s, (styles.get(s) ?? 0) + 1);
    for (const l of item.labels) labels.set(l, (labels.get(l) ?? 0) + 1);
    if (item.year) {
      minYear = Math.min(minYear, item.year);
      maxYear = Math.max(maxYear, item.year);
    }
  }

  const rank = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return {
    genres: rank(genres),
    styles: rank(styles),
    labels: rank(labels).slice(0, 200),
    minYear: Number.isFinite(minYear) ? minYear : 1950,
    maxYear: Number.isFinite(maxYear) ? maxYear : new Date().getFullYear(),
  };
}

export function applyFilters(
  pool: Playable[],
  filters: FilterState,
): Playable[] {
  const needle = filters.query.trim().toLowerCase();
  const genres = new Set(filters.genres);
  const styles = new Set(filters.styles);
  const labels = new Set(filters.labels);

  return pool.filter((item) => {
    if (filters.tracksOnly && item.matchKind !== "track") return false;

    if (filters.yearFrom !== null && (item.year ?? 0) < filters.yearFrom) return false;
    if (filters.yearTo !== null && (item.year ?? 9999) > filters.yearTo) return false;

    if (genres.size > 0 && !item.genres.some((g) => genres.has(g))) return false;
    if (styles.size > 0 && !item.styles.some((s) => styles.has(s))) return false;
    if (labels.size > 0 && !item.labels.some((l) => labels.has(l))) return false;

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
  collapsedCount = 12,
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
    return expanded || needle ? filtered.slice(0, 300) : filtered.slice(0, collapsedCount);
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
              className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
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

export function Filters({
  facets,
  filters,
  onChange,
  matched,
  total,
}: {
  facets: Facets;
  filters: FilterState;
  onChange: (next: FilterState) => void;
  matched: number;
  total: number;
}) {
  const toggle = (key: "genres" | "styles" | "labels") => (value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    });
  };

  const dirty =
    filters.query !== "" ||
    filters.genres.length > 0 ||
    filters.styles.length > 0 ||
    filters.labels.length > 0 ||
    filters.yearFrom !== null ||
    filters.yearTo !== null ||
    filters.tracksOnly;

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
            <span className="font-semibold text-neutral-300">{matched.toLocaleString()}</span>
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

      <section className="border-t border-ink-800 px-4 py-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
          Year
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={filters.yearFrom ?? ""}
            min={1900}
            max={2100}
            placeholder={String(facets.minYear)}
            onChange={(e) =>
              onChange({
                ...filters,
                yearFrom: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs"
            aria-label="Year from"
          />
          <span className="text-neutral-600">–</span>
          <input
            type="number"
            inputMode="numeric"
            value={filters.yearTo ?? ""}
            min={1900}
            max={2100}
            placeholder={String(facets.maxYear)}
            onChange={(e) =>
              onChange({
                ...filters,
                yearTo: e.target.value ? Number(e.target.value) : null,
              })
            }
            className="w-full rounded-md border border-ink-700 bg-ink-850 px-2 py-1 text-xs"
            aria-label="Year to"
          />
        </div>

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

      <ChipGroup
        label="Style"
        options={facets.styles}
        selected={filters.styles}
        onToggle={toggle("styles")}
      />
      <ChipGroup
        label="Genre"
        options={facets.genres}
        selected={filters.genres}
        onToggle={toggle("genres")}
      />
      <ChipGroup
        label="Label"
        options={facets.labels}
        selected={filters.labels}
        onToggle={toggle("labels")}
        collapsedCount={8}
      />
    </div>
  );
}
