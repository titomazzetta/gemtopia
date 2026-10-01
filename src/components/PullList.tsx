"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Playable } from "@/lib/types";
import { STRAIN_META, VERDICT_META, formatBpm, type MixCheck } from "@/lib/mixing";
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

  /*
   * Press and hold anywhere on a record to pick it up — the same drag as the
   * grip, for people who reach for the record rather than the handle.
   *
   * Touch events rather than pointer events, on purpose: once iOS decides a
   * touch is a scroll it cancels pointer events, and the only way to keep a
   * finger that is *holding a record* from scrolling the list is a
   * non-passive touchmove that calls preventDefault. So: a touch that moves
   * before 350ms is a scroll and is left alone; one that holds still for
   * 350ms becomes a drag, and from then on its moves are ours.
   */
  const suppressClick = useRef(false);
  const handlers = useRef({ slotFor, endDrag, cancelDrag });
  useEffect(() => {
    handlers.current = { slotFor, endDrag, cancelDrag };
  });

  useEffect(() => {
    const list = listRef.current;
    if (!list || !onReorder) return;
    let timer: number | null = null;
    let start: { x: number; y: number; index: number } | null = null;
    let active = false;

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      const target = event.target as HTMLElement | null;
      if (!touch || event.touches.length > 1 || !target) return;
      if (target.closest("[data-grip]")) return; // the grip handles itself
      const row = target.closest<HTMLElement>("[data-index]");
      if (!row) return;
      start = { x: touch.clientX, y: touch.clientY, index: Number(row.dataset.index) };
      clear();
      timer = window.setTimeout(() => {
        if (!start) return;
        active = true;
        const next = { from: start.index, slot: start.index };
        dragRef.current = next;
        setDrag(next);
        navigator.vibrate?.(12);
      }, 350);
    };

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !start) return;
      if (!active) {
        if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
          clear(); // it's a scroll
          start = null;
        }
        return;
      }
      event.preventDefault();
      const box = list.getBoundingClientRect();
      if (touch.clientY < box.top + 48) list.scrollTop -= 12;
      else if (touch.clientY > box.bottom - 48) list.scrollTop += 12;
      const current = dragRef.current;
      if (!current) return;
      const slot = handlers.current.slotFor(touch.clientY);
      if (slot !== current.slot) {
        const next = { ...current, slot };
        dragRef.current = next;
        setDrag(next);
      }
    };

    const onEnd = () => {
      clear();
      start = null;
      if (active) {
        active = false;
        // The finger lifting off also "clicks" the row; that click is not a play.
        suppressClick.current = true;
        // …and if no click follows (finger lifted off the row), forget it,
        // so the next real tap still plays.
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 400);
        handlers.current.endDrag();
      }
    };

    const onCancel = () => {
      clear();
      start = null;
      if (active) {
        active = false;
        handlers.current.cancelDrag();
      }
    };

    list.addEventListener("touchstart", onStart, { passive: true });
    list.addEventListener("touchmove", onMove, { passive: false });
    list.addEventListener("touchend", onEnd);
    list.addEventListener("touchcancel", onCancel);
    return () => {
      clear();
      list.removeEventListener("touchstart", onStart);
      list.removeEventListener("touchmove", onMove);
      list.removeEventListener("touchend", onEnd);
      list.removeEventListener("touchcancel", onCancel);
    };
  }, [onReorder]);

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
          {/*
            Two clearly different views, not one toggle that names the other.
            Compact: one line per record plus a pitch chip — the whole set on
            one screen. Detailed: the transition strip between every pair, the
            release and the label.
          */}
          <div
            role="radiogroup"
            aria-label="List density"
            className="mt-1 flex h-9 shrink-0 overflow-hidden rounded-full border border-ink-700 text-[11px]"
          >
            {([true, false] as const).map((value) => (
              <button
                key={String(value)}
                type="button"
                role="radio"
                aria-checked={dense === value}
                onClick={() => {
                  if (dense !== value) toggleDense();
                }}
                className={`px-3 ${
                  dense === value
                    ? "bg-accent font-semibold text-ink-950"
                    : "text-neutral-400 hover:text-neutral-100"
                }`}
              >
                {value ? "Compact" : "Detailed"}
              </button>
            ))}
          </div>
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
                  data-index={index}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  // No text selection or iOS callout on a long press — that
                  // press is picking the record up.
                  className={`relative select-none border-b border-ink-850 [-webkit-touch-callout:none] ${
                    dragging ? "bg-accent/15 opacity-60 ring-1 ring-inset ring-accent/60" : ""
                  } ${playing && !dragging ? "bg-accent/10" : ""}`}
                >
                  {dropAbove && <span aria-hidden="true" className="absolute inset-x-0 -top-px z-10 h-0.5 bg-accent" />}
                  {/* The transition *into* this record, so the list reads as a set. */}
                  {check && !dense && <TransitionStrip check={check} />}
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
                      onClick={() => {
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        onPlay(index);
                      }}
                      aria-label={`Play from ${row.number}. ${row.title}. Press and hold to move it.`}
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
                          {row.recordOnly && (
                            <span
                              className="mr-1.5 inline-block -translate-y-px rounded border border-neutral-700 px-1 align-middle text-[9px] font-medium uppercase leading-[14px] tracking-wide text-neutral-400"
                              title="No YouTube clip — play it from the record"
                            >
                              record only
                            </span>
                          )}
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
                      {dense ? (
                        // Compact: BPM, and the pitch the move *into* this
                        // record needs, coloured by how comfortable it is.
                        <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
                          {check && <PitchChip check={check} />}
                          <span className="w-8 text-right text-neutral-200">
                            {row.bpm !== null ? formatBpm(row.bpm) : "–"}
                          </span>
                        </span>
                      ) : (
                        <span className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 font-mono text-[11px] tabular-nums text-neutral-500">
                          {row.position && <span>{row.position}</span>}
                          {row.bpm !== null && <span className="text-neutral-300">{formatBpm(row.bpm)}</span>}
                        </span>
                      )}
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
                        data-grip=""
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

const CHIP_TONE: Record<string, string> = {
  good: "border-accent/40 text-accent",
  warn: "border-amber-400/50 text-amber-300",
  bad: "border-red-400/50 text-red-300",
  muted: "border-ink-700 text-neutral-600",
};

/**
 * The transition into a record, in five characters: the pitch each deck
 * moves to meet ("±1.8"), ×2 / ÷2 when it's a double- or half-time blend, and
 * the comfort tier as colour *and* as the title text — never colour alone.
 */
function PitchChip({ check }: { check: MixCheck }) {
  const tone = STRAIN_META[check.strain].tone;
  const pitch = check.outgoingPitch === null ? null : Math.abs(check.outgoingPitch);
  const shift = check.verdict === "double-time" || check.verdict === "half-time"
    ? VERDICT_META[check.verdict].short
    : "";
  return (
    <span
      title={`${STRAIN_META[check.strain].label} — ${check.summary}`}
      className={`rounded border px-1 py-px text-[10px] leading-none ${CHIP_TONE[tone] ?? CHIP_TONE.muted}`}
    >
      {shift}
      {pitch === null ? "no BPM" : `±${pitch.toFixed(1)}%`}
    </span>
  );
}
