"use client";

import {
  DECK_PRESETS,
  MAX_PITCH_PERCENT,
  MIN_PITCH_PERCENT,
  TRANSITION_RANGE,
  formatSetLength,
  type SequenceReport,
  type SetLength,
} from "@/lib/mixing";
import { Metronome, Shuffle } from "./Icons";

/**
 * Set-prep readout for the playlist currently open.
 *
 * The question this answers is the one you have while packing a record bag:
 * *when I get to the club, will these actually go together?* Every number here
 * is computed against the pitch range of the decks you told it you play on,
 * because "mixable" means nothing without that.
 */
export function SetPrepBar({
  report,
  pitchPercent,
  onPitchChange,
  onSmoothOrder,
  busy,
  length,
  transitionSeconds,
  onTransitionChange,
}: {
  report: SequenceReport;
  pitchPercent: number;
  onPitchChange: (percent: number) => void;
  onSmoothOrder: () => void;
  busy: boolean;
  length: SetLength;
  transitionSeconds: number;
  onTransitionChange: (seconds: number) => void;
}) {
  const total = report.steps.length;
  if (total === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-ink-800 bg-ink-900 px-4 py-1.5 text-[11px] text-neutral-600">
        <Metronome className="h-3 w-3" />
        Add a second track and Gemtopia will check whether they beatmatch.
      </div>
    );
  }

  const problems = report.stretch + report.impossible;
  const preset = DECK_PRESETS.find((d) => d.percent === pitchPercent);

  const segments = [
    { count: report.direct, label: "mix", className: "bg-accent" },
    { count: report.timeShifted, label: "×2 / ÷2", className: "bg-sky-400" },
    { count: report.stretch, label: "out of range", className: "bg-amber-400" },
    { count: report.impossible, label: "won't mix", className: "bg-red-400" },
    { count: report.unknown, label: "no BPM", className: "bg-ink-600" },
  ].filter((segment) => segment.count > 0);

  return (
    <div className="border-b border-ink-800 bg-ink-900 px-4 py-2">
      {/*
        Set length first, because it is the question you ask before any other:
        have I got enough records for the slot. The mixability bar answers a
        later question about the same list.
      */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800/70 pb-2">
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm font-semibold tabular-nums text-neutral-100">
            {length.partial ? "≥ " : ""}
            {formatSetLength(length.playedSeconds)}
          </span>
          <span className="text-[10px] text-neutral-600">
            {length.trackCount} track{length.trackCount === 1 ? "" : "s"}
          </span>
        </span>

        {/*
          A partial total is a floor, not an estimate, and says so. Claiming
          "1h 12m" when a fifth of the set has no runtime is a worse answer
          than admitting the total is incomplete.
        */}
        {length.partial && (
          <span
            className="text-[10px] text-amber-300/70"
            title={`${length.trackCount - length.timedCount} track(s) have no runtime from Discogs or YouTube`}
          >
            {length.trackCount - length.timedCount} without a runtime
          </span>
        )}

        <label className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-neutral-500">
          <span className="whitespace-nowrap">blend</span>
          <input
            type="range"
            min={TRANSITION_RANGE.min}
            max={TRANSITION_RANGE.max}
            step={5}
            value={transitionSeconds}
            onChange={(event) => onTransitionChange(Number(event.target.value))}
            aria-label="Average transition length, in seconds"
            className="w-24"
          />
          <span className="w-8 text-right font-mono tabular-nums text-neutral-400">
            {transitionSeconds}s
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Metronome className="h-3.5 w-3.5 shrink-0 text-neutral-500" />

        {/* Proportional bar: the shape of the set at a glance. */}
        <div className="flex h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-ink-800">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.className}
              style={{ width: `${(segment.count / total) * 100}%` }}
              title={`${segment.count} ${segment.label}`}
            />
          ))}
        </div>

        <span className="shrink-0 text-[11px] text-neutral-400">
          {problems === 0 ? (
            <span className="text-accent">
              All {total} transition{total === 1 ? "" : "s"} beatmatch
            </span>
          ) : (
            <>
              <span className="font-semibold text-amber-300">{problems}</span>
              <span className="text-neutral-500">
                {" "}
                of {total} won&rsquo;t beatmatch
              </span>
            </>
          )}
          {report.unknown > 0 && (
            <span className="text-neutral-600"> · {report.unknown} no BPM</span>
          )}
        </span>

        {/* Deck pitch range — the number everything above depends on. */}
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-neutral-500">
          <span className="hidden sm:inline">Decks</span>
          <select
            value={
              DECK_PRESETS.some((d) => d.percent === pitchPercent)
                ? String(pitchPercent)
                : "custom"
            }
            onChange={(event) => {
              if (event.target.value === "custom") return;
              onPitchChange(Number(event.target.value));
            }}
            className="rounded border border-ink-700 bg-ink-850 px-1.5 py-0.5 text-[11px] text-neutral-300"
            aria-label="Deck pitch range"
          >
            {DECK_PRESETS.map((deck) => (
              <option key={deck.id} value={deck.percent}>
                ±{deck.percent}% — {deck.label}
              </option>
            ))}
            {!DECK_PRESETS.some((d) => d.percent === pitchPercent) && (
              <option value="custom">±{pitchPercent}% — custom</option>
            )}
          </select>

          <input
            type="number"
            min={MIN_PITCH_PERCENT}
            max={MAX_PITCH_PERCENT}
            value={pitchPercent}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) onPitchChange(value);
            }}
            className="w-12 rounded border border-ink-700 bg-ink-850 px-1 py-0.5 text-center font-mono text-[11px]"
            aria-label="Custom pitch range percent"
            title="Any range you like — the presets are just the common ones"
          />
        </label>

        <button
          type="button"
          onClick={onSmoothOrder}
          disabled={busy || report.unknown === total}
          className="shrink-0 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-ink-600 hover:text-neutral-100 disabled:opacity-40"
          title="Reorder so consecutive records beatmatch, climbing in tempo"
        >
          <Shuffle className="mr-1 inline h-3 w-3" />
          Smooth order
        </button>
      </div>

      {preset?.note && (
        <p className="mt-1 text-[10px] text-neutral-600">
          ±{preset.percent}% on {preset.label}
          {preset.note ? ` · ${preset.note}` : ""} — both decks can pitch, so the
          real window is wider than ±{preset.percent}% suggests.
        </p>
      )}
    </div>
  );
}
