"use client";

import { useMemo, useState } from "react";
import {
  DECK_PRESETS,
  DEFAULT_PITCH_PERCENT,
  MAX_PITCH_PERCENT,
  MIN_PITCH_PERCENT,
  mixableWindow,
  comfortableWindow,
  STRAIN_META,
} from "@/lib/mixing";
import { Search } from "./Icons";
import {
  applyFilters,
  computeFacets,
  emptyFilters,
  folderChoices,
  MULTI_FACETS,
  pivotTo,
  toggleFolder,
  type FacetKey,
  type Facets,
  type FilterState,
  type MultiFacetKey,
  type StyleTempo,
} from "@/client/filters";
import { BPM_CEILING, BPM_FLOOR, BPM_HARD_MAX, BPM_HARD_MIN } from "@/lib/filterBounds";

// The filter model lives in client/filters.ts; re-exported here so the panel
// and the model keep one import for the app.
export { applyFilters, computeFacets, emptyFilters, MULTI_FACETS, pivotTo, BPM_CEILING, BPM_FLOOR, BPM_HARD_MAX, BPM_HARD_MIN };
export type { FacetKey, Facets, FilterState, MultiFacetKey, StyleTempo };

/* ------------------------------------------------------------------ */

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  collapsedCount = 10,
  matchAll,
  onMatchAllChange,
  hash = false,
  hide,
  onHideChange,
}: {
  label: string;
  options: Array<[string, number]>;
  selected: string[];
  onToggle: (value: string) => void;
  collapsedCount?: number;
  /** Undefined for facets where a record can only hold one value. */
  matchAll?: boolean;
  onMatchAllChange?: (all: boolean) => void;
  /** Your own tags: each chip reads "#deep", the way they're searched for. */
  hash?: boolean;
  /**
   * only / hide, for folders: "only these" keeps what's selected, "hide
   * these" drops it — the switch that turns a listening folder off.
   */
  hide?: boolean;
  onHideChange?: (hide: boolean) => void;
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
              className="flex overflow-hidden rounded-sm border border-ink-700"
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
                    hash
                      ? all
                        ? "Tracks with every selected tag"
                        : "Tracks with any selected tag"
                      : all
                        ? `Records tagged with every selected ${label.toLowerCase()}`
                        : `Records tagged with any selected ${label.toLowerCase()}`
                  }
                  className={`px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:text-[11px] ${
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

          {/*
            only / hide, as soon as one is selected: one folder is enough to
            ask "everything but this".
          */}
          {onHideChange && selected.length > 0 && (
            <div
              className="flex overflow-hidden rounded-sm border border-ink-700"
              role="group"
              aria-label={`${label} mode`}
            >
              {([false, true] as const).map((off) => (
                <button
                  key={String(off)}
                  type="button"
                  onClick={() => onHideChange(off)}
                  aria-pressed={Boolean(hide) === off}
                  title={off ? `Everything except the selected ${label.toLowerCase()}s` : `Only the selected ${label.toLowerCase()}s`}
                  className={`px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide transition-colors pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:text-[11px] ${
                    Boolean(hide) === off
                      ? off
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-accent/20 text-accent"
                      : "text-neutral-600 hover:text-neutral-300"
                  }`}
                >
                  {off ? "hide" : "only"}
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
          // A folder you're hiding is ticked, but green would read as "this
          // is what plays": it is struck through in amber instead.
          const hidden = active && Boolean(hide);
          // The count and the # sit on the chip's own tint once it is
          // selected, where a quiet grey is 4.0:1 — under AA. They go
          // to the dimmer accent instead, which still reads as secondary.
          const onTint = active && !hidden;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-pressed={active}
              title={hidden ? `Hidden — tap to show ${name} again` : undefined}
              className={`max-w-full truncate rounded-full border px-2 py-1 text-[11px] transition-colors ${
                hidden
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300/80"
                  : active
                    ? "border-accent/60 bg-accent/15 text-accent"
                    : "border-ink-700 bg-ink-850 text-neutral-400 hover:border-ink-600 hover:text-neutral-200"
              }`}
            >
              {hash && (
                <span aria-hidden="true" className={onTint ? "text-accent-dim" : "text-neutral-600"}>
                  #
                </span>
              )}
              <span className={hidden ? "line-through decoration-amber-300/60" : undefined}>{name}</span>
              <span className={`ml-1 ${onTint ? "text-accent-dim" : "text-neutral-600"}`}>{count}</span>
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
  onPitchChange,
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
  /** Omitted where the range is not editable. */
  onPitchChange?: (percent: number) => void;
}) {
  // Not bpm ± n. A pitch fader is a percentage and both decks have one, so the
  // window is asymmetric and wider than it looks. See lib/mixing.ts.
  const window = currentBpm !== null ? mixableWindow(currentBpm, pitchPercent) : null;
  // The part of that window where neither fader passes half its travel —
  // where most real blends live. Offered first because it is the useful one.
  const easyWindow =
    currentBpm !== null ? comfortableWindow(currentBpm, pitchPercent) : null;
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
      <div className="sticky top-0 z-10 bg-ink-900/95 px-4 py-3 backdrop-blur-sm">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" />
          <input
            id="dig-search"
            type="search"
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Artist, track, label or #tag…"
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
            {/* Tracks, like the header: record-only ones are in here too. */}
            {total.toLocaleString()} tracks
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
            className="flex-1 rounded-sm border border-ink-700 py-1 font-mono text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title="Halve the range — find the half-time versions"
          >
            ÷2
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, ...scaleRange(filters, 2) })}
            className="flex-1 rounded-sm border border-ink-700 py-1 font-mono text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title="Double the range — find the double-time versions"
          >
            ×2
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, bpmFrom: BPM_FLOOR, bpmTo: BPM_CEILING })}
            className="flex-2 rounded-sm border border-ink-700 py-1 text-[10px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
            title={`Back to the default ${BPM_FLOOR}–${BPM_CEILING} window`}
          >
            {BPM_FLOOR}–{BPM_CEILING}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...filters, bpmFrom: null, bpmTo: null })}
            className="flex-1 rounded-sm border border-ink-700 py-1 text-[10px] text-neutral-500 hover:border-ink-600 hover:text-neutral-100"
            title="No tempo constraint"
          >
            any
          </button>
        </div>

        {currentBpm !== null && window && easyWindow && (
          <>
            <button
              type="button"
              onClick={() =>
                onChange({ ...filters, bpmFrom: easyWindow.low, bpmTo: easyWindow.high })
              }
              className="mt-2 w-full rounded-full border border-accent/50 bg-accent/10 px-2 py-1 text-[11px] text-accent"
              title={`Neither deck past ±${pitchPercent / 2}% — the comfortable middle of the fader`}
            >
              {/* Same words as the strip and the set-prep bar, from the same
                  source, so one playlist never uses two vocabularies. */}
              {STRAIN_META.easy.label} with {currentBpm}
              <span className="ml-1 font-mono text-accent/70">
                {easyWindow.low}–{easyWindow.high}
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                onChange({ ...filters, bpmFrom: window.low, bpmTo: window.high })
              }
              className="mt-1 w-full rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-300/80 hover:bg-amber-400/5"
              title={`Both decks at the full ±${pitchPercent}% can meet anywhere from ${window.low} to ${window.high} — reachable, but you will hear it`}
            >
              Up to {STRAIN_META.pushed.label.toLowerCase()}
              <span className="ml-1 font-mono opacity-70">
                {window.low}–{window.high}
              </span>
            </button>

            {/*
              The deck range, here as well as in the set-prep bar.
              
              It lived only in SetPrepBar, which renders only while a playlist
              is open — so someone digging through the crate could see a
              "mixes with" window computed from a pitch range they had no way
              to reach, let alone change. The window is meaningless without the
              range that produced it, so the two belong together.

              It is the same server-persisted setting the set-prep bar edits,
              not a second copy: change it here and the transition verdicts on
              every playlist change with it.
            */}
            {onPitchChange && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-[10px] text-neutral-600">decks</span>
                <select
                  value={
                    DECK_PRESETS.some((d) => d.percent === pitchPercent)
                      ? String(pitchPercent)
                      : "custom"
                  }
                  onChange={(event) => {
                    if (event.target.value === "custom") return;
                    onPitchChange(Number(event.target.value));
                  }}
                  aria-label="Deck pitch range"
                  className="min-w-0 flex-1 rounded-sm border border-ink-700 bg-ink-900 px-1.5 py-0.5 text-[10px] text-neutral-300"
                >
                  {DECK_PRESETS.map((deck) => (
                    <option key={deck.id} value={deck.percent}>
                      ±{deck.percent}% — {deck.label}
                    </option>
                  ))}
                  {!DECK_PRESETS.some((d) => d.percent === pitchPercent) && (
                    <option value="custom">±{pitchPercent}% — custom</option>
                  )}
                </select>
                <input
                  type="number"
                  min={MIN_PITCH_PERCENT}
                  max={MAX_PITCH_PERCENT}
                  step={1}
                  value={pitchPercent}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    onPitchChange(
                      Math.max(
                        MIN_PITCH_PERCENT,
                        Math.min(MAX_PITCH_PERCENT, Math.round(value)),
                      ),
                    );
                  }}
                  aria-label="Custom deck pitch range percent"
                  className="w-10 shrink-0 rounded-sm border border-ink-700 bg-ink-900 px-1 py-0.5 text-center font-mono text-[10px] text-neutral-300"
                />
              </div>
            )}
          </>
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
                    <span className={`ml-1 font-mono ${active ? "text-accent-dim" : "text-neutral-600"}`}>
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
            No tempos catalogued yet. Hit <kbd className="rounded-sm bg-ink-800 px-1">T</kbd>{" "}
            in time while something plays, or turn on auto-detect in the player.
            Style bands appear here once there are a few readings.
          </p>
        )}

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={filters.withBpmOnly}
            onChange={(e) => onChange({ ...filters, withBpmOnly: e.target.checked })}
            className="h-3.5 w-3.5 rounded-sm border-ink-600 bg-ink-850 accent-accent"
          />
          Only tracks with a known BPM
        </label>
      </section>

      {/*
        Your own tags, above everything Discogs says about a record: they're
        the words you chose to find things by. Only there once you've tagged
        something in this crate.
      */}
      <ChipGroup
        label="Your tags"
        options={facets.tags}
        selected={filters.tags}
        onToggle={toggle("tags")}
        matchAll={filters.matchAll?.tags ?? false}
        onMatchAllChange={setMatchAll("tags")}
        collapsedCount={12}
        hash
      />

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
            className="h-3.5 w-3.5 rounded-sm border-ink-600 bg-ink-850 accent-accent"
          />
          Only clips matched to a single track
        </label>
      </section>

      {/*
        Your Discogs folders — "DJ", "Listening" — with only / hide. Absent
        until the folder list has been read, in wantlist mode (a want has no
        folder), and when the whole crate sits in one folder: a group with no
        choice in it is a question with no answer.
      */}
      <ChipGroup
        label="Folder"
        options={folderChoices(facets.folders, filters.folders)}
        selected={filters.folders}
        onToggle={(name) => onChange(toggleFolder(filters, name))}
        hide={filters.hideFolders}
        onHideChange={(hide) => onChange({ ...filters, hideFolders: hide })}
        collapsedCount={12}
      />
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
