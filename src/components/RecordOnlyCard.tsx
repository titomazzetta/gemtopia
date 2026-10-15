"use client";

import { useEffect, useRef, useState } from "react";
import type { Playable } from "@/lib/types";
import { TapTempo } from "@/client/tempo";
import { formatBpm } from "@/lib/mixing";
import { formatTime } from "./NowPlaying";
import { Disc, Plus } from "./Icons";

/**
 * A track YouTube has no clip for — "record only".
 *
 * Tapping one in a list opens this instead of playing anything: where it is
 * on the record, how long it runs, and a tap pad, so you can put the record on
 * the deck in the room, tap along, and have its BPM in your catalogue like any
 * other track. From here it can go into a playlist, which is how a set list
 * gets written from the shelf.
 *
 * Full width from the bottom on a phone, a card on desktop; × or Escape.
 * On a keyboard, T taps (the same key as the player's tap tempo) and A adds
 * it to a playlist — so on a laptop at the decks it's open, tap-tap-tap, A.
 */
export function RecordOnlyCard({
  item,
  bpm,
  onSaveBpm,
  onAdd,
  onClose,
}: {
  item: Playable;
  /** What the catalogue holds for it now. */
  bpm: number | null;
  onSaveBpm: (bpm: number, confidence: number) => void;
  /** Put it in a playlist (the usual picker). Omitted inside a playlist. */
  onAdd?: () => void;
  onClose: () => void;
}) {
  const tapper = useRef(new TapTempo());
  const [taps, setTaps] = useState(0);
  const [reading, setReading] = useState<number | null>(null);

  const tap = (at: number) => {
    const estimate = tapper.current.tap(at);
    setTaps(tapper.current.count);
    if (!estimate) return;
    setReading(estimate.bpm);
    onSaveBpm(estimate.bpm, estimate.confidence);
  };

  // The window listener is added once; these keep it calling the latest props.
  const latest = useRef({ onClose, onAdd, tap });
  useEffect(() => {
    latest.current = { onClose, onAdd, tap };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        latest.current.onClose();
      } else if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        // Held down, the keyboard's auto-repeat would be thirty taps a second.
        if (!event.repeat) latest.current.tap(event.timeStamp);
      } else if ((event.key === "a" || event.key === "A") && latest.current.onAdd) {
        event.preventDefault();
        latest.current.onAdd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Focus moves into the card, so Tab and Enter act on it and not on the row
   * behind it that opened it; it goes back to that row on close — unless
   * something else took it meanwhile (Add opens the playlist picker, whose
   * name field focuses itself).
   */
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const before = document.activeElement;
    // Only the first time: StrictMode runs this twice, and by the second run
    // the focused element is the card itself.
    if (opener.current === null && before instanceof HTMLElement && !panel.current?.contains(before)) {
      opener.current = before;
    }
    panel.current?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      const back = opener.current;
      if (back?.isConnected && (now === null || now === document.body)) {
        back.focus({ preventScroll: true });
      }
    };
  }, []);

  const shown = reading ?? bpm;
  const facts = [
    item.position,
    item.duration ? formatTime(item.duration) : null,
    item.labels[0] ?? null,
    item.year ? String(item.year) : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <div
      className="fixed inset-x-0 top-0 z-60 flex items-end justify-center bg-black/60 lg:items-center lg:p-8"
      style={{ bottom: "var(--mobile-bar-h, 0px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Record only: ${item.title}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        tabIndex={-1}
        // Focus parks here so keys act on the card; it isn't a control, so no ring.
        className="w-full rounded-t-2xl border-t border-ink-700 bg-ink-950 px-5 pb-5 pt-4 outline-none focus-visible:ring-0 focus-visible:ring-offset-0 lg:max-w-md lg:rounded-2xl lg:border"
      >
        <div className="flex items-start gap-3">
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-ink-800">
            {item.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : null}
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-neutral-600 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-neutral-300">
              <Disc className="h-3 w-3" />
              Record only
            </span>
            <h2 className="mt-1 truncate text-base font-semibold text-neutral-100">{item.title}</h2>
            <p className="truncate text-xs text-neutral-400">
              {item.artist} <span className="text-neutral-600">— {item.releaseTitle}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 -mt-1 rounded-md px-2 py-1 text-lg leading-none text-neutral-400 hover:bg-ink-800 hover:text-neutral-100"
          >
            ×
          </button>
        </div>

        {facts.length > 0 && (
          <p className="mt-3 font-mono text-xs tabular-nums text-neutral-300">{facts.join(" · ")}</p>
        )}

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          There&apos;s no YouTube clip of this track, so it won&apos;t play here and shuffle skips it.
          Put the record on, tap along to log its BPM, and add it to a set like any other track.
        </p>

        <div className="mt-4 flex items-stretch gap-3">
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              tap(event.timeStamp);
            }}
            className="flex flex-1 select-none flex-col items-center justify-center rounded-xl border border-accent/40 bg-accent/10 py-4 text-accent active:bg-accent/20 [-webkit-touch-callout:none] touch-manipulation"
            aria-label="Tap along to the beat"
          >
            <span className="text-sm font-semibold tracking-wider">TAP</span>
            <span className="mt-0.5 text-[10px] text-accent/70">
              {taps === 0 ? "with the kick" : taps < 3 ? `${taps}…` : `${taps} taps`}
              {taps === 0 && <span className="hidden pointer-fine:inline"> · or press T</span>}
            </span>
          </button>
          <div className="flex w-28 flex-col items-center justify-center rounded-xl border border-ink-700 bg-ink-900">
            <span className="font-mono text-2xl tabular-nums text-neutral-100">{formatBpm(shown)}</span>
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
              {reading !== null ? "saved" : "BPM"}
            </span>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {onAdd && (
            <button
              type="button"
              onClick={onAdd}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-ink-950"
            >
              <Plus className="h-4 w-4" />
              Add to playlist
              <kbd className="ml-1 hidden rounded-sm border border-ink-950/30 px-1 font-mono text-[10px] font-medium pointer-fine:inline">
                A
              </kbd>
            </button>
          )}
          <a
            href={`https://www.discogs.com/release/${item.releaseId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="flex flex-1 items-center justify-center rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-neutral-200 hover:border-neutral-500"
          >
            On Discogs
          </a>
        </div>
      </div>
    </div>
  );
}
