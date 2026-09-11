"use client";

import { useCallback, type RefObject } from "react";
import type { BpmSource, Playable } from "@/lib/types";
import type { PlayerApi } from "@/client/useYouTubePlayer";
import type { DetectorStatus } from "@/client/useTempoDetector";
import { formatBpm } from "@/lib/mixing";
import {
  Compass,
  Disc,
  Metronome,
  Mic,
  Next,
  Pause,
  Play,
  Plus,
  Prev,
  Repeat,
  Shuffle,
  Volume,
  Waveform,
} from "./Icons";
import { ShareButton } from "./ShareButton";

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

export interface TempoPanelProps {
  /** Stored BPM for the current clip, if any. */
  bpm: number | null;
  bpmSource: BpmSource | null;
  /** Rolling live estimate from the audio detector. */
  liveBpm: number | null;
  liveConfidence: number;
  detectorStatus: DetectorStatus;
  detectorError: string | null;
  tapCount: number;
  onTap: () => void;
  onStartDetector: (source: "tab" | "mic") => void;
  onStopDetector: () => void;
  /** Halve or double the stored reading — the DnB octave escape hatch. */
  onScaleBpm: (factor: 0.5 | 2) => void;
  onClearBpm: () => void;
}

function TempoPanel({
  bpm,
  bpmSource,
  liveBpm,
  liveConfidence,
  detectorStatus,
  detectorError,
  tapCount,
  onTap,
  onStartDetector,
  onStopDetector,
  onScaleBpm,
  onClearBpm,
  disabled,
}: TempoPanelProps & { disabled: boolean }) {
  const listening = detectorStatus === "listening";

  const sourceLabel: Record<BpmSource, string> = {
    tap: "tapped",
    auto: "detected",
    discogs: "from Discogs",
    manual: "manual",
  };

  return (
    <div className="rounded-md border border-ink-800 bg-ink-850/60 p-2">
      <div className="flex items-center gap-2">
        <Metronome className="h-3.5 w-3.5 shrink-0 text-neutral-500" />

        <div className="min-w-0 flex-1">
          {bpm !== null ? (
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-sm font-semibold tabular-nums text-neutral-100">
                {formatBpm(bpm, { precise: true })}
              </span>
              <span className="text-[10px] text-neutral-600">
                BPM {bpmSource ? `· ${sourceLabel[bpmSource]}` : ""}
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-neutral-600">
              {listening && liveBpm !== null
                ? `listening… ~${formatBpm(liveBpm)}`
                : "no BPM yet"}
            </span>
          )}
        </div>

        {bpm !== null && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => onScaleBpm(0.5)}
              title="Halve — for when a 174 track reads as 87"
              className="rounded px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 hover:bg-ink-800 hover:text-neutral-200"
            >
              ÷2
            </button>
            <button
              type="button"
              onClick={() => onScaleBpm(2)}
              title="Double"
              className="rounded px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 hover:bg-ink-800 hover:text-neutral-200"
            >
              ×2
            </button>
            <button
              type="button"
              onClick={onClearBpm}
              title="Clear this reading"
              className="rounded px-1.5 py-0.5 text-[10px] text-neutral-600 hover:bg-ink-800 hover:text-red-400"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Live confidence meter while the detector runs. */}
      {listening && liveBpm !== null && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${Math.round(liveConfidence * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-neutral-600">
            {Math.round(liveConfidence * 100)}%
          </span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onTap}
          disabled={disabled}
          title="Tap in time with the beat (T)"
          className="flex flex-1 items-center justify-center gap-1 rounded border border-ink-700 py-1 text-[10px] font-medium text-neutral-300 hover:border-ink-600 hover:text-white disabled:opacity-40"
        >
          TAP
          {tapCount > 0 && (
            <span className="font-mono text-neutral-600">{tapCount}</span>
          )}
        </button>

        {listening ? (
          <button
            type="button"
            onClick={onStopDetector}
            title="Stop listening"
            className="flex items-center gap-1 rounded border border-accent/50 bg-accent/10 px-2 py-1 text-[10px] text-accent"
          >
            <Waveform className="h-3 w-3" />
            live
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStartDetector("tab")}
            title="Detect BPM from this tab's audio (Chrome / Edge)"
            className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[10px] font-medium text-accent hover:bg-accent/20"
          >
            <Waveform className="h-3 w-3" />
            Detect
          </button>
        )}
      </div>

      {/*
        Detection has to be armed by a click — `getDisplayMedia` refuses to run
        without a user gesture, in every browser, by design. It cannot be turned
        on at load or on the app's behalf.

        But it only needs the one click. The stream stays open for the session
        and every track played afterwards is analysed with no further
        interaction, which is the behaviour people expect and previously could
        not find: this used to be a 10px button labelled "auto", so nobody armed
        it and the BPM catalogue stayed empty.
      */}
      {!listening && (
        <div className="mt-1.5 rounded border border-ink-800 bg-ink-900/60 px-2 py-1.5">
          <p className="text-[10px] leading-relaxed text-neutral-500">
            <span className="text-neutral-300">Detect</span> reads the tempo
            from this tab&rsquo;s audio. Chrome asks once — pick this tab and
            tick <span className="text-neutral-400">Share tab audio</span>.
            After that every track you play is measured automatically.
          </p>
          <button
            type="button"
            onClick={() => onStartDetector("mic")}
            className="mt-1 flex items-center gap-1 text-[10px] text-neutral-600 hover:text-neutral-300"
          >
            <Mic className="h-3 w-3" />
            Use the microphone instead — works in Safari and Firefox
          </button>
        </div>
      )}

      {detectorError && (
        <p className="mt-1.5 text-[10px] leading-snug text-amber-300/80">
          {detectorError}
        </p>
      )}
    </div>
  );
}

export function NowPlaying({
  containerRef,
  api,
  current,
  queuePosition,
  queueLength,
  shuffleOn,
  repeatOn,
  tempo,
  digging,
  onToggleShuffle,
  onToggleRepeat,
  onPrev,
  onNext,
  onAddToPlaylist,
  onDig,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  api: PlayerApi;
  current: Playable | null;
  queuePosition: number;
  queueLength: number;
  shuffleOn: boolean;
  repeatOn: boolean;
  tempo: TempoPanelProps;
  digging: boolean;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onPrev: () => void;
  onNext: () => void;
  onAddToPlaylist: () => void;
  onDig: () => void;
}) {
  const progress = api.duration > 0 ? (api.currentTime / api.duration) * 100 : 0;

  const onScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(event.target.value) / 1000;
      if (api.duration > 0) api.seek(pct * api.duration);
    },
    [api],
  );

  /*
   * On a phone this becomes a video strip at the top of the screen, and
   * everything below it is hidden — the transport lives in MobileBar at thumb
   * height, and the rest in the player sheet.
   *
   * The video itself cannot move to a sheet, and cannot be hidden. YouTube's
   * IFrame API terms require the player stay visible at 200x200 or larger and
   * unobscured while it plays; a `display: none` iframe would breach that, and
   * browsers throttle hidden iframes, so it would likely stop playing anyway.
   * So on mobile the video stays on screen and the controls go to the bottom —
   * the honest resolution of "controls where the thumb is" against a constraint
   * that is not ours to negotiate.
   *
   * `order-first` puts it above the list on mobile; on desktop it returns to
   * the right-hand column.
   */
  return (
    <aside
      className={`order-first w-full flex-col border-b border-ink-800 bg-ink-900 lg:order-none lg:flex lg:w-[320px] lg:shrink-0 lg:border-b-0 lg:border-l ${
        /*
         * On a phone the video strip collapses entirely when nothing is
         * queued. YouTube's visibility requirement applies to a player that is
         * playing; with an empty queue there is no player content, only 200px
         * of black — and those 200px are worth four more records during
         * exactly the phase where you are browsing rather than listening.
         * Desktop keeps the panel at all times: there is room, and the empty
         * state is doing useful work as a "nothing queued" affordance.
         */
        current ? "flex" : "hidden lg:flex"
      }`}
    >
      <div className="relative mx-auto aspect-square w-[min(52vw,200px)] bg-black lg:mx-0 lg:w-full">
        <div className="absolute inset-0" ref={containerRef} />
        {!current && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-850 text-neutral-600">
            <Disc className="h-10 w-10" />
            <p className="text-xs">Nothing queued</p>
          </div>
        )}
      </div>

      <div className="hidden flex-1 flex-col gap-3 p-4 lg:flex">
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

        <TempoPanel {...tempo} disabled={!current} />

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
            onClick={onDig}
            disabled={!current}
            className={`flex w-full items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
              digging
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-ink-700 bg-ink-850 text-neutral-300 hover:border-ink-600 hover:text-white"
            }`}
            title="Everything this record connects to (D)"
          >
            <Compass className="h-3.5 w-3.5" />
            {digging ? "Digging" : "Dig from this"}
            <kbd className="ml-1 rounded bg-ink-800 px-1 font-mono text-[10px] text-neutral-500">D</kbd>
          </button>

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

          <ShareButton track={current} variant="wide" />

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
