"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Playable } from "@/lib/types";
import { formatBpm, type MixCheck } from "@/lib/mixing";
import { TransitionStrip } from "./TrackList";
import { prunePulled, pullRows, recordCount, togglePulled } from "@/client/pullList";
import { Play } from "./Icons";

/**
 * A playlist as the list you take to the shelves. See client/pullList.ts.
 *
 * Full screen on a phone, a centred panel on a desktop, closed from the corner
 * or with Escape. Tap a row to tick it off as pulled; ▶ plays from there.
 * Ticks are kept in this browser only — they are about this pull, not the
 * set — and a tick for a record no longer in the playlist is dropped.
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
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/70 lg:items-center lg:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={`Pull list: ${name}`}
    >
      <div className="flex h-full w-full flex-col bg-ink-950 lg:h-auto lg:max-h-[85vh] lg:max-w-xl lg:rounded-xl lg:border lg:border-ink-700">
        <header className="flex shrink-0 items-start gap-3 border-b border-ink-800 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Pull list</p>
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
            aria-label="Close pull list"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-ink-700 text-lg text-neutral-300 hover:border-ink-600 hover:text-neutral-100"
          >
            ×
          </button>
        </header>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-neutral-600">This playlist is empty.</p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
            {rows.map((row, index) => {
              const done = pulled.has(row.key);
              const check = transitions?.get(index);
              const who = addedBy?.[index] ?? null;
              return (
                <li key={`${row.key}:${index}`} className="border-b border-ink-850">
                  {/* The transition *into* this record, so the list reads as a set. */}
                  {check && <TransitionStrip check={check} />}
                  <div className="flex items-stretch">
                    <button
                      type="button"
                      onClick={() => save(togglePulled(pulled, row.key))}
                      aria-pressed={done}
                      className={`flex min-w-0 flex-1 items-start gap-3 pl-4 pr-2 text-left ${
                        dense ? "py-1.5" : "py-3"
                      } ${done ? "opacity-45" : ""}`}
                    >
                      <span className="w-7 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums text-neutral-500">
                        {done ? "✓" : row.number}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm text-neutral-100 ${done ? "line-through" : ""}`}>
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
                    <button
                      type="button"
                      onClick={() => onPlay(index)}
                      aria-label={`Play from ${row.number}. ${row.title}`}
                      className="grid w-12 shrink-0 place-items-center text-neutral-500 hover:text-accent"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
