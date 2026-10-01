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

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tap = (at: number) => {
    const estimate = tapper.current.tap(at);
    setTaps(tapper.current.count);
    if (!estimate) return;
    setReading(estimate.bpm);
    onSaveBpm(estimate.bpm, estimate.confidence);
  };

  const shown = reading ?? bpm;
  const facts = [
    item.position,
    item.duration ? formatTime(item.duration) : null,
    item.labels[0] ?? null,
    item.year ? String(item.year) : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex items-end justify-center bg-black/60 lg:items-center lg:p-8"
      style={{ bottom: "var(--mobile-bar-h, 0px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Record only: ${item.title}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full rounded-t-2xl border-t border-ink-700 bg-ink-950 px-5 pb-5 pt-4 lg:max-w-md lg:rounded-2xl lg:border">
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
            className="flex flex-1 select-none flex-col items-center justify-center rounded-xl border border-accent/40 bg-accent/10 py-4 text-accent active:bg-accent/20 [-webkit-touch-callout:none] [touch-action:manipulation]"
            aria-label="Tap along to the beat"
          >
            <span className="text-sm font-semibold tracking-wider">TAP</span>
            <span className="mt-0.5 text-[10px] text-accent/70">
              {taps === 0 ? "with the kick" : taps < 3 ? `${taps}…` : `${taps} taps`}
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
