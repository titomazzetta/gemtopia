"use client";

import { useEffect, useRef, useState } from "react";
import type { BpmSource, Playable } from "@/lib/types";
import { TapTempo, type FoldWindow } from "@/client/tempo";
import { useTempoDetector } from "@/client/useTempoDetector";
import { formatBpm } from "@/lib/mixing";
import { formatTime } from "./NowPlaying";
import { Disc, Mic, Plus } from "./Icons";
import { TagEditor } from "./TagEditor";

/**
 * A track YouTube has no clip for — "record only".
 *
 * Tapping one in a list opens this instead of playing anything: where it is
 * on the record, how long it runs, and two ways to get its tempo while the
 * record plays in the room — tap along, or press Listen and let the
 * microphone hear it. Either way the BPM lands in your catalogue like any
 * other track's. From here it goes into a set in one tap, which is how a set
 * list gets written from the shelf.
 *
 * Full width from the bottom on a phone, a card on desktop; × or Escape.
 * On a keyboard, T taps (the same key as the player's tap tempo), A adds it
 * to your current set and Shift+A picks another — so at the decks it's open,
 * tap-tap-tap, A.
 */
export function RecordOnlyCard({
  item,
  bpm,
  bpmFrom = null,
  onSaveBpm,
  addTo = null,
  onAdd,
  onChoose,
  fold,
  tags,
  onClose,
}: {
  item: Playable;
  /** What the catalogue holds for it now. */
  bpm: number | null;
  /** How that reading was made. A tap (or a typed one) outranks the mic. */
  bpmFrom?: BpmSource | null;
  /** A reading for this track: tapped here, or heard through the mic. */
  onSaveBpm: (bpm: number, confidence: number, source: "tap" | "auto") => void;
  /** The set one tap adds to, by name. Null: Add opens the picker instead. */
  addTo?: string | null;
  /** Add it to that set (or, with no set yet, open the picker). */
  onAdd?: () => void;
  /** The picker, for any other set. */
  onChoose?: () => void;
  /** The BPM window to read the mic in: the record's genre pocket, or your range. */
  fold?: FoldWindow;
  /** Your tags on this track, and the rest of yours to suggest. */
  tags?: {
    value: readonly string[];
    ranked: ReadonlyArray<readonly [string, number]>;
    onChange: (tags: string[]) => void;
  };
  onClose: () => void;
}) {
  const tapper = useRef(new TapTempo());
  const [taps, setTaps] = useState(0);
  const [reading, setReading] = useState<{
    bpm: number;
    /** "kept": heard, but a tap you made before stays the reading. */
    how: "tapped" | "heard" | "kept";
  } | null>(null);

  /*
   * The latest props and actions, for the two listeners added once: the
   * window's keydown and the detector's commit. Filled in after every render.
   */
  const latest = useRef({
    onClose,
    onAdd,
    onChoose,
    onSaveBpm,
    bpmFrom,
    tap: (_at: number) => {},
    stopListening: () => {},
  });

  /*
   * Listen: the same detector the player uses for its microphone mode, run
   * for this card alone. It needs a reading to hold steady before it says
   * anything (useTempoDetector commits only after agreeing estimates), and
   * once it has one, the mic is released — there's nothing left to hear.
   */
  const listener = useTempoDetector({
    fold,
    onCommit: (estimate) => {
      latest.current.stopListening();
      // The catalogue never lets a detection replace a tap (the server's
      // precedence rule), so don't claim it did: show what was heard, and
      // leave the tap standing.
      const tapped = latest.current.bpmFrom === "tap" || latest.current.bpmFrom === "manual";
      setReading({ bpm: estimate.bpm, how: tapped ? "kept" : "heard" });
      if (!tapped) latest.current.onSaveBpm(estimate.bpm, estimate.confidence, "auto");
    },
  });
  const listening = listener.status === "listening" || listener.status === "requesting";

  const tap = (at: number) => {
    // A tap is someone saying what the tempo is: it outranks the mic.
    if (listening) listener.stop();
    const estimate = tapper.current.tap(at);
    setTaps(tapper.current.count);
    if (!estimate) return;
    setReading({ bpm: estimate.bpm, how: "tapped" });
    onSaveBpm(estimate.bpm, estimate.confidence, "tap");
  };

  useEffect(() => {
    latest.current = { onClose, onAdd, onChoose, onSaveBpm, bpmFrom, tap, stopListening: listener.stop };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Typing a tag: T and A are letters, not taps and adds. Esc still
      // closes the card (the tag field takes the first one, to clear itself).
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (typing && event.key !== "Escape") return;
      if (event.key === "Escape") {
        latest.current.onClose();
      } else if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        // Held down, the keyboard's auto-repeat would be thirty taps a second.
        if (!event.repeat) latest.current.tap(event.timeStamp);
      } else if (event.key === "a" && latest.current.onAdd) {
        event.preventDefault();
        latest.current.onAdd();
      } else if (event.key === "A" && (latest.current.onChoose ?? latest.current.onAdd)) {
        // Shift+A: choose the set.
        event.preventDefault();
        (latest.current.onChoose ?? latest.current.onAdd)!();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /*
   * Focus moves into the card, so Tab and Enter act on it and not on the row
   * behind it that opened it; it goes back to that row on close — unless
   * something else took it meanwhile (Other… opens the playlist picker, whose
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

  // A heard reading that a tap outranks is shown in the status line, not here.
  const shown = reading && reading.how !== "kept" ? reading.bpm : bpm;
  const facts = [
    item.position,
    item.duration ? formatTime(item.duration) : null,
    item.labels[0] ?? null,
    item.year ? String(item.year) : null,
  ].filter((f): f is string => Boolean(f));

  const listenLine =
    listener.status === "requesting"
      ? "Allow the microphone…"
      : listener.status === "listening"
        ? listener.live
          ? `Hearing about ${formatBpm(listener.live.bpm)} — hold on`
          : "Listening — put the needle down"
        : reading?.how === "kept"
          ? `Heard ${formatBpm(reading.bpm)}. Your tapped ${formatBpm(bpm)} stays — tap again to change it.`
          : null;

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

        <p className="mt-3 flex flex-wrap items-baseline gap-x-2 font-mono text-xs tabular-nums text-neutral-300">
          {facts.length > 0 && <span>{facts.join(" · ")}</span>}
          <a
            href={`https://www.discogs.com/release/${item.releaseId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-sans text-[11px] text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-200"
          >
            On Discogs ↗
          </a>
        </p>

        <p className="mt-3 text-xs leading-relaxed text-neutral-500">
          There&apos;s no YouTube clip of this track, so it won&apos;t play here and shuffle skips it.
          Put the record on and tap along — or press Listen and let the mic hear it — to log its BPM,
          and add it to a set like any other track.
        </p>

        <div className="mt-4 flex items-stretch gap-2">
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
          {listener.status !== "unsupported" && (
            <button
              type="button"
              onClick={() => (listening ? listener.stop() : void listener.start("mic"))}
              aria-pressed={listening}
              title="Measure it from the record playing in the room, through the microphone"
              className={`flex w-24 flex-col items-center justify-center rounded-xl border py-4 text-xs font-semibold ${
                listening
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-ink-700 bg-ink-900 text-neutral-200 hover:border-ink-600"
              }`}
            >
              <Mic className={`h-4 w-4 ${listening ? "animate-pulse" : ""}`} />
              <span className="mt-1">{listening ? "Stop" : "Listen"}</span>
            </button>
          )}
          <div className="flex w-24 flex-col items-center justify-center rounded-xl border border-ink-700 bg-ink-900">
            <span className="font-mono text-2xl tabular-nums text-neutral-100">{formatBpm(shown)}</span>
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">
              {reading && reading.how !== "kept"
                ? reading.how === "heard"
                  ? "heard · saved"
                  : "saved"
                : bpmFrom === "tap"
                  ? "tapped"
                  : "BPM"}
            </span>
          </div>
        </div>

        {(listenLine || listener.error) && (
          <p
            role="status"
            className={`mt-2 text-[11px] ${listener.error ? "text-amber-300" : "text-neutral-400"}`}
          >
            {listener.error ?? listenLine}
          </p>
        )}

        {tags && (
          <div className="mt-4">
            <p className="mb-1.5 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-neutral-500">
              <span className="font-semibold">Your tags</span>
              <span className="normal-case tracking-normal text-neutral-600">only you see them</span>
            </p>
            <TagEditor
              tags={tags.value}
              ranked={tags.ranked}
              onChange={tags.onChange}
              label={`Your tags for ${item.title}`}
            />
          </div>
        )}

        {onAdd && (
          <div className="mt-4 flex gap-2">
            {/*
              One tap to the set it names; Other… for any other one. With no
              set yet, the one button is the picker, and what you pick there
              becomes the set.
            */}
            <button
              type="button"
              onClick={onAdd}
              className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-ink-950"
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">{addTo ? `Add to ${addTo}` : "Add to playlist"}</span>
              <kbd className="ml-1 hidden shrink-0 rounded-sm border border-ink-950/30 px-1 font-mono text-[10px] font-medium pointer-fine:inline">
                A
              </kbd>
            </button>
            {addTo && onChoose && (
              <button
                type="button"
                onClick={onChoose}
                title="Add to another playlist (Shift+A)"
                className="shrink-0 rounded-lg border border-ink-700 px-3 py-2.5 text-sm text-neutral-200 hover:border-neutral-500"
              >
                Other…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
