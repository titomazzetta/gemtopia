"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Playable } from "@/lib/types";
import { VERDICT_META, type MixCheck } from "@/lib/mixing";
import { formatTime } from "./NowPlaying";
import { formatBpm } from "@/lib/mixing";
import { NoPreview, Play, Plus, Trash } from "./Icons";
import { ShareButton } from "./ShareButton";
import type { SortKey, SortState } from "@/client/sorting";

const BASE_ROW_HEIGHT = 56;
/** Extra height for the transition strip when set-prep mode is on. */
const TRANSITION_HEIGHT = 22;
const OVERSCAN = 8;

const TONE_CLASS: Record<string, string> = {
  good: "text-accent/80 border-accent/25 bg-accent/5",
  shift: "text-sky-300/90 border-sky-400/25 bg-sky-400/5",
  warn: "text-amber-300/90 border-amber-400/30 bg-amber-400/5",
  bad: "text-red-300/90 border-red-400/30 bg-red-400/5",
  muted: "text-neutral-600 border-ink-800 bg-transparent",
};

/**
 * The strip between two records in a playlist.
 *
 * Reads as one line a DJ can scan while packing a bag: can these two be
 * beatmatched, at what tempo, and how far each fader has to move. When they
 * cannot, it says what pitch range *would* have worked — that is the number
 * that tells you whether to swap the record or swap the deck.
 */
function TransitionStrip({ check }: { check: MixCheck }) {
  const meta = VERDICT_META[check.verdict];
  return (
    <div
      className={`flex h-[22px] items-center gap-1.5 border-l-2 px-3 text-[10px] ${TONE_CLASS[meta.tone]}`}
      title={check.summary}
    >
      <span className="font-mono opacity-70">↳</span>
      <span className="font-medium">{meta.label}</span>
      <span className="truncate opacity-80">{check.summary}</span>
    </div>
  );
}

/**
 * Windowed list.
 *
 * A 1,500-record crate produces a few thousand clips. Rendering that many DOM
 * rows makes filtering feel sticky on a laptop, so we render only the visible
 * slice — ~30 rows — and translate the viewport. Fixed row height keeps this
 * to about forty lines instead of pulling in a virtualisation library.
 */
/**
 * A clickable column heading.
 *
 * The arrow shows the direction only for the active column. Showing a faint
 * arrow on every sortable column — a common pattern — makes the active one
 * harder to spot, which is the one thing the row has to communicate.
 */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState | null | undefined;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      /*
       * The state goes in the label rather than aria-sort, because aria-sort
       * belongs on a columnheader and this is not a table — it is a virtualised
       * list, and scattering table roles across it would describe a structure
       * that is not there. A label that says what the control currently does is
       * both accurate and more useful read aloud.
       */
      aria-label={
        active
          ? `Sort by ${label}, currently ${sort?.direction === "asc" ? "ascending" : "descending"}`
          : `Sort by ${label}`
      }
      className={`flex items-center gap-0.5 text-[10px] uppercase tracking-wider transition-colors ${
        active ? "text-accent" : "text-neutral-600 hover:text-neutral-300"
      } ${className}`}
    >
      {label}
      {active && (
        <span aria-hidden="true" className="text-[8px]">
          {sort?.direction === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

export function TrackList({
  items,
  currentKey,
  onPlay,
  onAdd,
  onRemove,
  emptyMessage,
  emptyAction,
  reorderable = false,
  onReorder,
  transitions,
  sort,
  onSort,
}: {
  items: Playable[];
  currentKey: string | null;
  onPlay: (index: number) => void;
  onAdd?: (item: Playable) => void;
  onRemove?: (item: Playable, index: number) => void;
  emptyMessage: string;
  /**
   * Offered beneath the empty message. An empty crate is the one moment the
   * app knows exactly what you were looking for and cannot give it to you,
   * which makes it the right place to offer the next move rather than a full
   * stop.
   */
  emptyAction?: ReactNode;
  reorderable?: boolean;
  onReorder?: (from: number, to: number) => void;
  /** Mix check for the transition *into* each index. Index 0 has none. */
  transitions?: Map<number, MixCheck>;
  /** Current column sort, or null for the list's own order. */
  sort?: SortState | null;
  /** Omitted where sorting makes no sense — a playlist has a real order. */
  onSort?: (key: SortKey) => void;
}) {
  const showTransitions = Boolean(transitions && transitions.size > 0);
  const ROW_HEIGHT = showTransitions
    ? BASE_ROW_HEIGHT + TRANSITION_HEIGHT
    : BASE_ROW_HEIGHT;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const dragIndex = useRef<number | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN,
  );
  const slice = items.slice(start, end);

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-neutral-600">
        <p>{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        The header sits outside the scrolling viewport, not inside it. The list
        is virtualised — only the visible rows exist — so a header row placed
        among them would be recycled away the moment you scrolled.

        It appears only when `onSort` is passed, which is the crate. A playlist
        has a real order that means something, and offering to re-sort the view
        would put the displayed order and the stored order into disagreement —
        with transition checks between rows that are no longer adjacent.
      */}
      {onSort && (
        <div className="flex shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900/60 px-3 py-1.5">
          <span className="w-9 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <SortHeader label="Title" sortKey="title" sort={sort} onSort={onSort} />
            <SortHeader label="Artist" sortKey="artist" sort={sort} onSort={onSort} />
            <SortHeader label="Label" sortKey="label" sort={sort} onSort={onSort} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SortHeader
              label="Year"
              sortKey="year"
              sort={sort}
              onSort={onSort}
              className="hidden w-8 justify-end sm:flex"
            />
            <SortHeader
              label="BPM"
              sortKey="bpm"
              sort={sort}
              onSort={onSort}
              className="w-11 justify-end"
            />
            <SortHeader
              label="Len"
              sortKey="duration"
              sort={sort}
              onSort={onSort}
              className="w-10 justify-end"
            />
          </div>
          {(onAdd || onRemove) && <span className="w-7 shrink-0" aria-hidden="true" />}
        </div>
      )}

      <div ref={viewportRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: items.length * ROW_HEIGHT, position: "relative" }}>
        <ul
          style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
          className="absolute inset-x-0 top-0"
        >
          {slice.map((item, i) => {
            const index = start + i;
            const active = item.key === currentKey;
            /*
             * Shown, but visibly not playable. Hiding these was the old
             * behaviour and it meant you could own a record, sync it, and
             * never see it — with nothing on screen admitting that. Dimmed
             * plus an icon plus a title attribute, so the reason survives
             * whether you are scanning, hovering, or using a screen reader.
             */
            const silent = item.silence !== null;
            const silentReason =
              item.silence === "not-loaded"
                ? "Not synced yet — hit refresh to fetch this release"
                : "Discogs has no audio for this pressing";

            return (
              <li
                key={`${item.key}:${index}`}
                style={{ height: ROW_HEIGHT }}
                draggable={reorderable}
                onDragStart={() => (dragIndex.current = index)}
                onDragOver={(e) => reorderable && e.preventDefault()}
                onDrop={() => {
                  if (!reorderable || dragIndex.current === null) return;
                  onReorder?.(dragIndex.current, index);
                  dragIndex.current = null;
                }}
                className={`group border-b border-ink-850 ${
                  active ? "bg-accent/10" : "hover:bg-ink-850"
                } ${reorderable ? "cursor-grab active:cursor-grabbing" : ""} ${
                  silent ? "opacity-45" : ""
                }`}
              >
                {showTransitions &&
                  (transitions?.get(index) ? (
                    <TransitionStrip check={transitions.get(index)!} />
                  ) : (
                    <div className="h-[22px] px-3 text-[10px] leading-[22px] text-neutral-700">
                      {index === 0 ? "opens the set" : ""}
                    </div>
                  ))}

                <div className="flex items-center gap-3 px-3" style={{ height: BASE_ROW_HEIGHT }}>
                <button
                  type="button"
                  onClick={() => onPlay(index)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                >
                  <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-ink-800">
                    {item.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumb}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                    {silent ? (
                      <span
                        className="absolute inset-0 grid place-items-center bg-black/65"
                        title={silentReason}
                      >
                        <NoPreview className="h-3.5 w-3.5 text-neutral-400" />
                      </span>
                    ) : (
                      <span
                        className={`absolute inset-0 hidden place-items-center bg-black/60 group-hover:grid ${
                          active ? "grid" : ""
                        }`}
                      >
                        <Play className="h-3 w-3 text-white" />
                      </span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[13px] ${
                        active ? "font-semibold text-accent" : "text-neutral-200"
                      }`}
                    >
                      {item.position ? (
                        <span className="mr-1.5 font-mono text-[10px] text-neutral-600">
                          {item.position}
                        </span>
                      ) : null}
                      {item.title}
                    </span>
                    <span className="block truncate text-[11px] text-neutral-500">
                      {item.artist}
                      <span className="text-neutral-700"> — {item.releaseTitle}</span>
                      {silent && (
                        <span className="ml-1.5 text-neutral-600">
                          ·{" "}
                          {item.silence === "not-loaded"
                            ? "not synced"
                            : "no preview"}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="hidden shrink-0 items-center gap-2 sm:flex">
                    {item.styles[0] && (
                      <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        {item.styles[0]}
                      </span>
                    )}
                    <span className="hidden w-8 text-right font-mono text-[10px] text-neutral-600 sm:inline">
                      {item.year ?? ""}
                    </span>
                    {/*
                      BPM sits immediately left of the runtime and holds its
                      column whether or not there is a reading, so the numbers
                      stay in a scannable line down the list. When you are
                      ordering a set, a tempo that jumps position row to row is
                      unreadable — the alignment is the feature.

                      An em-dash rather than a blank says "not measured yet",
                      which is different from "no tempo", and pushes you toward
                      the tracks worth playing through to fill in.
                    */}
                    <span
                      className={`w-11 text-right font-mono text-[10px] tabular-nums ${
                        item.bpm !== null && item.bpm !== undefined
                          ? "text-accent/80"
                          : "text-neutral-700"
                      }`}
                      title={
                        item.bpm !== null && item.bpm !== undefined
                          ? `${item.bpm} BPM`
                          : "No BPM yet — play it through, or tap T"
                      }
                    >
                      {formatBpm(item.bpm)}
                    </span>
                    <span className="w-10 text-right font-mono text-[10px] tabular-nums text-neutral-600">
                      {item.duration ? formatTime(item.duration) : "--:--"}
                    </span>
                  </span>
                </button>

                <ShareButton track={item} />

                {onAdd && !silent && (
                  <button
                    type="button"
                    onClick={() => onAdd(item)}
                    title="Add to playlist"
                    className="shrink-0 rounded p-1.5 text-neutral-600 transition-opacity hover:bg-ink-800 hover:text-accent focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}

                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(item, index)}
                    title="Remove from playlist"
                    className="shrink-0 rounded p-1.5 text-neutral-600 transition-opacity hover:bg-ink-800 hover:text-red-400 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      </div>
    </div>
  );
}
