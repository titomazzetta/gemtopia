"use client";

import { useRef, useState } from "react";

import type { Playable } from "@/lib/types";
import { formatBpm } from "@/lib/mixing";
import { formatTime } from "./NowPlaying";
import { positionOf, secondsOf, SCRUB_STEPS } from "@/client/scrub";
import { Next, Pause, Play, Plus, Prev } from "./Icons";
import { ShareButton } from "./ShareButton";

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
 *
 * **Add and share sit in the bar too.** Both were reachable only by opening
 * the player sheet, which is the wrong cost for the two things you do most
 * while auditioning: "keep this" and "show someone this". They sit left of TAP
 * so the transport keeps the middle and your thumb learns three zones —
 * transport, actions, tempo — rather than six undifferentiated buttons.
 *
 * **The scrubber is here rather than in the player sheet.** Seeking is not an
 * occasional action when you are auditioning records — you skip past the intro
 * to hear where the track actually goes, constantly. Behind a sheet that costs
 * a tap, a wait, and your place in the list. The desktop scrubber lives in the
 * sidebar, which is `hidden` below `lg`, so until now a phone had no way to
 * seek at all.
 */
export function MobileBar({
  current,
  playing,
  bpm,
  tapCount,
  currentTime,
  duration,
  onSeek,
  onAddToPlaylist,
  onTap,
  detour = null,
  onBackToShuffle,
  onToggle,
  onPrev,
  onNext,
  onExpand,
}: {
  current: Playable | null;
  playing: boolean;
  bpm: number | null;
  tapCount: number;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
  onAddToPlaylist: () => void;
  /**
   * `at` is the pointer event's own timestamp. Typed to take it on purpose:
   * this was `() => void`, which let the click event itself slip through at
   * runtime as the "timestamp" once the handler started accepting one.
   */
  onTap: (at?: number) => void;
  /** Set while exploring a record away from the shuffle. */
  detour?: { label: string } | null;
  onBackToShuffle?: () => void;
  onToggle: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExpand: () => void;
}) {
  const seekable = duration > 0;

  /*
   * While a finger is down the thumb is driven locally, not by the player.
   * `currentTime` polls on a timer, and a poll arriving mid-drag overwrites
   * the input's value and snaps the thumb back out from under you. Holding the
   * position here and committing on release is the difference between a
   * scrubber that works and one that fights you.
   *
   * Keyboard use never sees a pointerup, so an arrow-key change seeks
   * immediately — `dragging` is what distinguishes the two.
   */
  const [held, setHeld] = useState<number | null>(null);
  const dragging = useRef(false);

  const position = held ?? positionOf(currentTime, duration);
  const shownTime = held === null ? currentTime : secondsOf(held, duration);

  const commit = () => {
    dragging.current = false;
    if (held !== null) {
      if (seekable) onSeek(secondsOf(held, duration));
      setHeld(null);
    }
  };

  return (
    <div className="shrink-0 border-t border-ink-800 bg-ink-900/95 backdrop-blur lg:hidden">
      {/*
        There is no B key on a phone, so the way back from a record lives in
        the one bar that is always on screen. Full width and 36px tall: this is
        the control you reach for mid-set with one thumb.
      */}
      {detour && onBackToShuffle && (
        <button
          type="button"
          onClick={onBackToShuffle}
          className="flex min-h-[36px] w-full items-center gap-2 border-b border-accent/20 bg-accent/5 px-3 text-left text-[11px]"
        >
          <span className="min-w-0 flex-1 truncate text-neutral-400">
            Exploring <span className="text-neutral-200">{detour.label}</span>
          </span>
          <span className="shrink-0 font-medium text-accent">← Back to shuffle</span>
        </button>
      )}
      {/*
        Position expressed in thousandths rather than seconds. A range whose max
        is the track length gives one step per second — coarse enough that on a
        six-minute rip you cannot land on the drop.
      */}
      <div className="px-3 pt-2">
        <input
          type="range"
          min={0}
          max={SCRUB_STEPS}
          value={position}
          onPointerDown={() => (dragging.current = true)}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (dragging.current) setHeld(next);
            else if (seekable) onSeek(secondsOf(next, duration));
          }}
          disabled={!current || !seekable}
          aria-label="Seek"
          aria-valuetext={`${formatTime(shownTime)} of ${formatTime(duration)}`}
          className="touch-none disabled:opacity-40"
        />
        <div className="mt-0.5 flex justify-between font-mono text-[10px] tabular-nums text-neutral-600">
          {/* Reads the held position while dragging, so you can see where you are landing. */}
          <span className={held === null ? "" : "text-accent"}>{formatTime(shownTime)}</span>
          <span>{seekable ? formatTime(duration) : "--:--"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        {/*
          Tapping the track info expands the full player sheet — the standard
          gesture, and it keeps the bar itself to controls.
        */}
        <button
          type="button"
          onClick={onExpand}
          disabled={!current}
          className="flex min-w-0 flex-1 items-center text-left disabled:opacity-50"
          aria-label="Open player"
        >
          {/*
            No sleeve here. Six controls, artwork and two lines of text do not
            fit across 390px — at full width the title truncated to about eight
            characters, which is worse than useless when the whole job of this
            row is telling you what is playing. The sleeve is the only
            decorative element in the bar and it is already on screen in the
            video strip directly above, so it is what gets cut.
          */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-neutral-100">
              {current?.title ?? "Nothing playing"}
            </span>
            <span className="block truncate text-[11px] text-neutral-500">
              {current ? current.artist : "Pick a record, or hit shuffle"}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onPrev}
            disabled={!current}
            aria-label="Previous"
            className="rounded-full p-1.5 text-neutral-400 active:bg-ink-800 disabled:opacity-30"
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
            className="rounded-full p-1.5 text-neutral-400 active:bg-ink-800 disabled:opacity-30"
          >
            <Next className="h-4 w-4" />
          </button>

          {/*
            The two actions worth doing without leaving the list. A hairline
            separates them from the transport — six buttons in an undivided row
            is a thing you have to read every time; three small groups is a
            thing you learn once.
          */}
          <span className="mx-0.5 h-5 w-px bg-ink-700" aria-hidden="true" />

          <ShareButton track={current} className="text-neutral-400 active:bg-ink-800" />

          <button
            type="button"
            onClick={onAddToPlaylist}
            disabled={!current}
            aria-label="Add to playlist"
            className="rounded-full p-1.5 text-neutral-400 active:bg-ink-800 disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
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
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              onTap(event.timeStamp);
            }}
            onClick={(event) => {
              // Keyboard activation only; a pointer press already counted.
              if (event.detail === 0) onTap(event.timeStamp);
            }}
            disabled={!current}
            aria-label="Tap tempo"
            className={`ml-0.5 flex h-11 w-11 touch-manipulation select-none items-center justify-center rounded-lg border text-center font-mono text-[11px] tabular-nums transition-colors disabled:opacity-30 ${
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
