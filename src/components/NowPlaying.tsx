"use client";

import { useCallback, type RefObject } from "react";
import type { Playable } from "@/lib/types";
import type { PlayerApi } from "@/client/useYouTubePlayer";
import { Disc, Next, Pause, Play, Plus, Prev, Repeat, Shuffle, Volume } from "./Icons";

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function NowPlaying({
  containerRef,
  api,
  current,
  queuePosition,
  queueLength,
  shuffleOn,
  repeatOn,
  onToggleShuffle,
  onToggleRepeat,
  onPrev,
  onNext,
  onAddToPlaylist,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  api: PlayerApi;
  current: Playable | null;
  queuePosition: number;
  queueLength: number;
  shuffleOn: boolean;
  repeatOn: boolean;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAddToPlaylist: () => void;
}) {
  const progress = api.duration > 0 ? (api.currentTime / api.duration) * 100 : 0;

  const onScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(event.target.value) / 1000;
      if (api.duration > 0) api.seek(pct * api.duration);
    },
    [api],
  );

  return (
    <aside className="flex w-full flex-col border-l border-ink-800 bg-ink-900 lg:w-[320px] lg:shrink-0">
      {/*
        The YouTube player. It stays visible at ≥200x200 because YouTube's API
        terms require exactly that — see useYouTubePlayer.ts. Here it simply
        does the job album art would do, and every control below is ours.
      */}
      <div className="relative aspect-square w-full bg-black">
        <div className="absolute inset-0" ref={containerRef} />
        {!current && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-850 text-neutral-600">
            <Disc className="h-10 w-10" />
            <p className="text-xs">Nothing queued</p>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-h-[52px]">
          {current ? (
            <>
              <div className="flex items-start gap-2">
                <h2 className="flex-1 text-sm font-semibold leading-snug text-neutral-100">
                  {current.title}
                </h2>
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    current.matchKind === "track"
                      ? "bg-accent/15 text-accent"
                      : "bg-amber-400/15 text-amber-300"
                  }`}
                  title={
                    current.matchKind === "track"
                      ? "This clip was matched to a single track on the release"
                      : "Discogs attached this clip to the release, not a track — it may be a full side, album, or mix"
                  }
                >
                  {current.matchKind === "track" ? "track" : "release"}
                </span>
              </div>
              <p className="truncate text-xs text-neutral-400">{current.artist}</p>
              <p className="truncate text-[11px] text-neutral-600">
                {current.releaseTitle}
                {current.year ? ` · ${current.year}` : ""}
                {current.labels[0] ? ` · ${current.labels[0]}` : ""}
              </p>
            </>
          ) : (
            <p className="text-xs text-neutral-600">
              Pick a track, or hit shuffle to start.
            </p>
          )}
        </div>

        {api.error && (
          <p role="status" className="rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-300">
            {api.error}
          </p>
        )}

        {/* Scrubber */}
        <div>
          <input
            type="range"
            min={0}
            max={1000}
            value={api.duration > 0 ? Math.round(progress * 10) : 0}
            onChange={onScrub}
            disabled={!current || api.duration === 0}
            aria-label="Seek"
            aria-valuetext={`${formatTime(api.currentTime)} of ${formatTime(api.duration)}`}
          />
          <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-neutral-500">
            <span>{formatTime(api.currentTime)}</span>
            <span>{api.duration > 0 ? formatTime(api.duration) : "--:--"}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onToggleShuffle}
            aria-pressed={shuffleOn}
            title="Shuffle (S)"
            className={`rounded-md p-2 transition-colors ${
              shuffleOn ? "bg-accent/15 text-accent" : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            <Shuffle />
          </button>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              title="Previous (←)"
              className="rounded-md p-2 text-neutral-300 hover:bg-ink-800 hover:text-white"
            >
              <Prev className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={api.toggle}
              disabled={!current}
              title="Play / pause (Space)"
              className="rounded-full bg-accent p-3 text-ink-950 transition-transform hover:scale-105 disabled:opacity-30 disabled:hover:scale-100"
            >
              {api.status === "playing" ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </button>

            <button
              type="button"
              onClick={onNext}
              title="Next (→)"
              className="rounded-md p-2 text-neutral-300 hover:bg-ink-800 hover:text-white"
            >
              <Next className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleRepeat}
            aria-pressed={repeatOn}
            title="Repeat queue (R)"
            className={`rounded-md p-2 transition-colors ${
              repeatOn ? "bg-accent/15 text-accent" : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            <Repeat />
          </button>
        </div>

        {/* Volume + queue position */}
        <div className="flex items-center gap-2">
          <Volume className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
          <input
            type="range"
            min={0}
            max={100}
            value={api.volume}
            onChange={(e) => api.setVolume(Number(e.target.value))}
            aria-label="Volume"
          />
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-neutral-500">
            {api.volume}
          </span>
        </div>

        <div className="mt-auto space-y-2">
          <button
            type="button"
            onClick={onAddToPlaylist}
            disabled={!current}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 py-2 text-xs font-medium text-neutral-300 hover:border-ink-600 hover:text-white disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            Add to playlist
            <kbd className="ml-1 rounded bg-ink-800 px-1 font-mono text-[10px] text-neutral-500">A</kbd>
          </button>

          <p className="text-center font-mono text-[10px] text-neutral-600">
            {queueLength > 0
              ? `${queuePosition + 1} / ${queueLength} in queue`
              : "queue empty"}
          </p>
        </div>
      </div>
    </aside>
  );
}
