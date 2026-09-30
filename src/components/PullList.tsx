"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Playable } from "@/lib/types";
import { formatBpm, type MixCheck } from "@/lib/mixing";
import { TransitionStrip } from "./TrackList";
import {
  prunePulled,
  pullRows,
  recordCount,
  slotAt,
  slotToIndex,
  togglePulled,
} from "@/client/pullList";
import { Play } from "./Icons";

/**
 * The whole set at once. See client/pullList.ts.
 *
 * On a phone this is where a playlist gets worked on: every record with its
 * BPM and the transition into it, tap a row to hear it (the list stays open,
 * and the player bar stays underneath it), drag the handle to move it, tap
 * the number to tick it off when you pull it. A centred panel on desktop,
 * closed from the corner or with Escape. Ticks are kept in this browser only
 * — they are about this pull, not the set — and a tick for a record no longer
 * in the playlist is dropped.
 */
export function PullList({
  playlistId,
  name,
  items,
  onClose,
  onPlay,
  transitions,
  addedBy,
  collab = false,
  playingKey = null,
  onReorder,
}: {
  playlistId: string;
  name: string;
  /** The stored order — the set — not whatever view is on. */
  items: Playable[];
  onClose: () => void;
  onPlay: (index: number) => void;
  /**
   * The mix check *into* each index, in the same stored order — the pitch
   * each deck needs and whether it fits your decks' range. Shown between
   * rows so the whole set reads at a glance, not one row at a time.
   */
  transitions?: Map<number, MixCheck>;
  /** Who added each record, by index, on a collaborative playlist. */
  addedBy?: Array<string | null>;
  collab?: boolean;
  /** What is playing, so its row can say so. */
  playingKey?: string | null;
  /** Move a record within the set. Omitted, the list is read-only. */
  onReorder?: (from: number, to: number) => void;
}) {
  const storageKey = `gemtopia:pulled:${playlistId}`;
  const [pulled, setPulled] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return prunePulled(
        Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
        items,
      );
    } catch {
      return new Set();
    }
  });

  /*
   * Compact rows: title, artist and BPM on two short lines, so a phone shows a
   * dozen records at once instead of a handful. Remembered per browser.
   */
  const [dense, setDense] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("gemtopia:list-dense") !== "0";
    } catch {
      return true;
    }
  });
  const toggleDense = () => {
    setDense((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("gemtopia:list-dense", next ? "1" : "0");
      } catch {
        // Not remembered this time; still works.
      }
      return next;
    });
  };

  const save = (next: Set<string>) => {
    setPulled(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      // Private mode or storage full: ticks still work for this visit.
    }
  };

  const rows = useMemo(() => pullRows(items), [items]);
  const records = useMemo(() => recordCount(items), [items]);
  const pulledRecords = useMemo(
    () => new Set(items.filter((item) => pulled.has(item.key)).map((item) => item.releaseId)).size,
    [items, pulled],
  );

  /* ---------- drag to reorder ---------- */

  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
  const dragRef = useRef<{ from: number; slot: number } | null>(null);

  const slotFor = (clientY: number) =>
    slotAt(
      clientY,
      rowRefs.current.slice(0, rows.length).map((el) => {
        const rect = el?.getBoundingClientRect();
        return rect ? rect.top + rect.height / 2 : Number.POSITIVE_INFINITY;
      }),
    );

  const startDrag = (event: React.PointerEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { from: index, slot: index };
    dragRef.current = next;
    setDrag(next);
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const current = dragRef.current;
    if (!current) return;
    // Near the top or bottom edge, scroll the list so a record can travel
    // further than one screen.
    const list = listRef.current;
    if (list) {
      const box = list.getBoundingClientRect();
      if (event.clientY < box.top + 48) list.scrollTop -= 12;
      else if (event.clientY > box.bottom - 48) list.scrollTop += 12;
    }
    const slot = slotFor(event.clientY);
    if (slot !== current.slot) {
      const next = { ...current, slot };
      dragRef.current = next;
      setDrag(next);
    }
  };

  const endDrag = () => {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || !onReorder) return;
    const to = slotToIndex(current.from, current.slot);
    if (to !== current.from) onReorder(current.from, to);
  };

  const cancelDrag = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const closeRef = useRef<HTMLButtonElement | null>(null);
  /*
   * The parent re-renders several times a second while something plays, and
   * hands a fresh onClose each time. Held in a ref so the effect below runs
   * once — otherwise focus would jump back to the close button mid-scroll.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
      // Stops above the phone's player bar, so the transport and the scrubber
      // stay in reach while you audition and reorder. 0 on desktop.
      style={{ bottom: "var(--mobile-bar-h, 0px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Whole list: ${name}`}
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:h-auto lg:max-h-[85vh] lg:max-w-xl lg:rounded-xl lg:border lg:border-ink-700">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Whole list</p>
            <h2 className="truncate text-base font-semibold text-neutral-100">{name}</h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {items.length} track{items.length === 1 ? "" : "s"} · {records} record{records === 1 ? "" : "s"}
              {pulledRecords > 0 && (
                <span className="text-accent"> · {pulledRecords} pulled</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={toggleDense}
            aria-pressed={dense}
            className="mt-1 h-9 shrink-0 rounded-full border border-ink-700 px-3 text-[11px] text-neutral-300 hover:border-accent/50 hover:text-accent"
          >
            {dense ? "Roomy" : "Compact"}
          </button>
          {pulled.size > 0 && (
            <button
              type="button"
              onClick={() => save(new Set())}
              className="mt-1 h-9 shrink-0 px-2 text-[11px] text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
            >
              Clear ticks
            </button>
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the whole list"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-700 text-lg text-neutral-300 hover:border-ink-600 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-600">This playlist is empty.</p>
        ) : (
          <ol
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
          >
            {rows.map((row, index) => {
              const done = pulled.has(row.key);
              const check = transitions?.get(index);
              const who = addedBy?.[index] ?? null;
              const playing = row.key === playingKey;
              const dragging = drag?.from === index;
              // The line that shows where a dragged record will land.
              const dropAbove = drag !== null && drag.slot === index && drag.slot !== drag.from && drag.slot !== drag.from + 1;
              const dropBelow = drag !== null && index === rows.length - 1 && drag.slot === rows.length && drag.from !== rows.length - 1;
              return (
                <li
                  key={`${row.key}:${index}`}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  className={`relative border-b border-ink-850 ${dragging ? "opacity-40" : ""} ${
                    playing ? "bg-accent/10" : ""
                  }`}
                >
                  {dropAbove && <span aria-hidden="true" className="absolute inset-x-0 -top-px z-10 h-0.5 bg-accent" />}
                  {/* The transition *into* this record, so the list reads as a set. */}
                  {check && <TransitionStrip check={check} />}
                  <div className="flex items-stretch">
                    {/* The number ticks the record off as pulled. */}
                    <button
                      type="button"
                      onClick={() => save(togglePulled(pulled, row.key))}
                      aria-pressed={done}
                      aria-label={done ? `Untick ${row.title}` : `Tick ${row.title} as pulled`}
                      className="w-11 shrink-0 pl-2 text-right font-mono text-sm tabular-nums text-neutral-500"
                    >
                      {done ? <span className="text-accent">✓</span> : row.number}
                    </button>
                    {/* The row plays from here — and the list stays open. */}
                    <button
                      type="button"
                      onClick={() => onPlay(index)}
                      aria-label={`Play from ${row.number}. ${row.title}`}
                      className={`flex min-w-0 flex-1 items-start gap-3 pl-2 pr-1 text-left ${
                        dense ? "py-1.5" : "py-3"
                      } ${done ? "opacity-45" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm ${playing ? "font-medium text-accent" : "text-neutral-100"} ${
                            done ? "line-through" : ""
                          }`}
                        >
                          {playing && <Play className="mr-1 inline h-3 w-3" />}
                          {row.title}
                        </span>
                        <span className="block truncate text-xs text-neutral-400">
                          {row.artist}
                          {!dense && <span className="text-neutral-600"> — {row.releaseTitle}</span>}
                          {collab && who && <span className="text-accent-alt/80"> · added by {who}</span>}
                        </span>
                        {!dense && (row.label || row.sameRecordAs !== null) && (
                          <span className="block truncate text-[11px] text-neutral-600">
                            {row.label}
                            {row.label && row.sameRecordAs !== null ? " · " : ""}
                            {row.sameRecordAs !== null && (
                              <span className="text-amber-300/80">same record as #{row.sameRecordAs}</span>
                            )}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 font-mono text-[11px] tabular-nums text-neutral-500">
                        {row.position && <span>{row.position}</span>}
                        {row.bpm !== null && <span className="text-neutral-300">{formatBpm(row.bpm)}</span>}
                      </span>
                    </button>
                    {/*
                      Drag handle. Touch-first: pointer events, captured, with
                      touch-action off on the handle only, so the list still
                      scrolls from anywhere else on the row.
                    */}
                    {onReorder && (
                      <span
                        role="button"
                        tabIndex={-1}
                        aria-label={`Drag to move ${row.title}`}
                        onPointerDown={(event) => startDrag(event, index)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        className="grid w-11 shrink-0 cursor-grab touch-none select-none place-items-center text-neutral-600 active:cursor-grabbing active:text-accent"
                      >
                        <GripIcon />
                      </span>
                    )}
                  </div>
                  {dropBelow && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px z-10 h-0.5 bg-accent" />}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/** Six dots — the grip that says "this moves". */
function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
}
