"use client";

import type { Playable } from "@/lib/types";
import { formatBpm } from "@/lib/mixing";
import { Next, Pause, Play, Prev } from "./Icons";

/**
 * The sticky player bar. Phones only.
 *
 * Two decisions worth stating, because both were made against the obvious.
 *
 * **It is at the bottom, not the top.** A thumb reaches the bottom third of a
 * phone and barely reaches the top. That is why every music app puts transport
 * down here, and it matters more in this app than in most: tab-audio capture
 * does not exist on any mobile browser, so **tap is the primary way a tempo
 * gets measured on a phone**. Putting the most-used control where the thumb
 * has to stretch would be the single worst ergonomic choice available.
 *
 * **TAP is a first-class button, not a menu item.** It sits next to play/pause
 * at full size. On desktop it is one option among several because auto
 * detection carries the load; on a phone it *is* the feature.
 */
export function MobileBar({
  current,
  playing,
  bpm,
  tapCount,
  onTap,
  onToggle,
  onPrev,
  onNext,
  onExpand,
}: {
  current: Playable | null;
  playing: boolean;
  bpm: number | null;
  tapCount: number;
  onTap: () => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExpand: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-900/95 backdrop-blur lg:hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        {/*
          Tapping the track info expands the full player sheet — the standard
          gesture, and it keeps the bar itself to controls.
        */}
        <button
          type="button"
          onClick={onExpand}
          disabled={!current}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left disabled:opacity-50"
          aria-label="Open player"
        >
          <span className="h-9 w-9 shrink-0 overflow-hidden rounded bg-ink-800">
            {current?.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.thumb}
                alt=""
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : null}
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-neutral-100">
              {current?.title ?? "Nothing playing"}
            </span>
            <span className="block truncate text-[11px] text-neutral-500">
              {current ? current.artist : "Pick a record, or hit shuffle"}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPrev}
            disabled={!current}
            aria-label="Previous"
            className="rounded-full p-2 text-neutral-400 active:bg-ink-800 disabled:opacity-30"
          >
            <Prev className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onToggle}
            disabled={!current}
            aria-label={playing ? "Pause" : "Play"}
            className="rounded-full bg-accent p-2.5 text-ink-950 active:scale-95 disabled:opacity-30"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onNext}
            disabled={!current}
            aria-label="Next"
            className="rounded-full p-2 text-neutral-400 active:bg-ink-800 disabled:opacity-30"
          >
            <Next className="h-4 w-4" />
          </button>

          {/*
            The tempo control. Shows the reading when there is one and turns
            into a tap target when there isn't — same button, so its position
            never moves and your thumb learns one place.

            44x56, set explicitly rather than as a minimum: `min-h` in a flex
            row with `items-center` collapsed it to 19px, because the row sizes
            children to their content and a minimum on the cross axis does not
            fight that. 44px is the platform floor for a touch target, and
            tapping a beat accurately is harder than tapping a link.
          */}
          <button
            type="button"
            onClick={onTap}
            disabled={!current}
            aria-label="Tap tempo"
            className={`ml-0.5 flex h-11 w-14 items-center justify-center rounded-lg border text-center font-mono text-[11px] tabular-nums transition-colors disabled:opacity-30 ${
              bpm !== null
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-ink-700 text-neutral-400 active:bg-ink-800"
            }`}
          >
            {tapCount > 0 && bpm === null ? (
              <span className="text-neutral-500">{tapCount}</span>
            ) : bpm !== null ? (
              formatBpm(bpm)
            ) : (
              "TAP"
            )}
          </button>
        </div>
      </div>

      {/* Home-indicator clearance. */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
