"use client";

import { useState } from "react";
import type { SyncState } from "@/lib/types";

/**
 * The sync banner.
 *
 * The first sync of a real collection takes ten minutes or more — not because
 * the app is slow, but because Discogs allows 60 requests a minute and a
 * 1,500-record crate needs one per release. A thin progress bar reads as
 * "something is stuck". A record going round reads as "something is working",
 * which is the truth.
 *
 * So: a spinning platter, the actual count, and copy that admits how long this
 * is going to take rather than hoping you don't notice.
 */

/** Below this, don't bother making a thing of it — it'll be over in a moment. */
const LONG_HAUL_SECONDS = 10;

/**
 * A record, turning.
 *
 * `animation-duration` is 1.8s, which is 33⅓ rpm slowed to something that
 * doesn't strobe against a 60Hz refresh. Grooves are concentric circles at
 * decreasing opacity; the label is the accent colour so it reads at 20px.
 */
function SpinningRecord({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={`h-9 w-9 shrink-0 ${spinning ? "animate-spin-record" : ""}`}
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="19" fill="#0a0a0b" />
      <circle cx="20" cy="20" r="19" fill="none" stroke="#2a2a31" strokeWidth="1" />
      {[16, 13.5, 11, 8.5].map((r, i) => (
        <circle
          key={r}
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="#3a3a44"
          strokeWidth="0.5"
          opacity={0.9 - i * 0.15}
        />
      ))}
      <circle cx="20" cy="20" r="6" fill="#4ade80" />
      {/* The off-centre fleck is what makes the rotation legible at all. */}
      <circle cx="20" cy="15.4" r="0.9" fill="#0a0a0b" opacity="0.55" />
      <circle cx="20" cy="20" r="1.5" fill="#0a0a0b" />
    </svg>
  );
}

/**
 * Copy for the long haul, chosen once per sync so it doesn't flicker between
 * renders. Deliberately warm rather than apologetic — a big collection is the
 * good problem to have.
 */
const OPENERS = [
  "Well now. That's quite the collection.",
  "Oh, this is a proper crate.",
  "Right — you weren't exaggerating about the collection.",
  "That is a lot of records. Respect.",
];

function formatEta(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes === 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 6) / 10;
  return `about ${hours} hours`;
}

export function SyncBanner({ sync }: { sync: SyncState }) {
  const active =
    sync.status === "listing" ||
    sync.status === "detailing" ||
    sync.status === "paused";

  /*
   * Rate is measured, not assumed. Discogs' ceiling is 60/min but real
   * throughput depends on batch size, cache hits and how the API is feeling,
   * so an estimate built from a constant would be confidently wrong. Take one
   * sample when a run starts and extrapolate from observed progress.
   *
   * This is derived state, not an effect. Setting state from inside an effect
   * here would render once with a stale estimate and again with the fresh one
   * on every single batch — which is both a wasted render per record and the
   * thing `react-hooks/set-state-in-effect` exists to stop. Adjusting state
   * during render when the run changes is React's documented pattern for
   * exactly this, and it costs no effect and no extra pass.
   *
   * The clock is `sync.updatedAt`, not `Date.now()`. Reading the wall clock
   * during render is impure — React may render twice, or not when you expect —
   * and it also measures the wrong thing: the gap between renders rather than
   * the gap between measurements. `updatedAt` is stamped when progress was
   * actually recorded, so the rate it yields is the sync's real throughput,
   * and a tab throttled in the background does not skew it.
   */
  const runKey = active && sync.total > 0 ? `${sync.source}:${sync.total}` : null;
  const [sample, setSample] = useState<{ at: number; done: number } | null>(null);
  const [seenRun, setSeenRun] = useState<string | null>(null);
  const [opener] = useState(() => OPENERS[Math.floor(Math.random() * OPENERS.length)]);

  if (runKey !== seenRun) {
    setSeenRun(runKey);
    setSample(runKey ? { at: sync.updatedAt, done: sync.detailed } : null);
  }

  let eta: number | null = null;
  if (sample && sync.total > 0) {
    const elapsed = (sync.updatedAt - sample.at) / 1000;
    const completed = sync.detailed - sample.done;
    // A few seconds and a few records, before an estimate means anything.
    if (elapsed >= 4 && completed >= 3) {
      const perSecond = completed / elapsed;
      if (perSecond > 0) {
        eta = Math.round((sync.total - sync.detailed) / perSecond);
      }
    }
  }

  if (!active && sync.status !== "error") return null;

  const percent =
    sync.total > 0 ? Math.min(100, Math.round((sync.detailed / sync.total) * 100)) : 0;
  // Narrowed rather than boolean, so formatEta gets a number without a cast.
  const longHaulEta = eta !== null && eta > LONG_HAUL_SECONDS ? eta : null;
  const counting = sync.status === "detailing" && sync.total > 0;

  if (sync.status === "error") {
    return (
      <div
        role="alert"
        className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300"
      >
        {sync.message ?? "Sync failed."}
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-b border-ink-800 bg-ink-850 px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3.5">
        <SpinningRecord spinning={active && sync.status !== "paused"} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] font-medium text-neutral-200">
              {sync.status === "listing"
                ? "Reading your crate…"
                : sync.status === "paused"
                  ? "Paused — Discogs rate limit"
                  : "Extrapolating collection…"}
            </span>

            {counting && (
              <span className="font-mono text-[11px] tabular-nums text-neutral-500">
                {sync.detailed.toLocaleString()} of {sync.total.toLocaleString()}
              </span>
            )}
          </div>

          {/*
            The long-haul line only appears once there is a measured estimate
            saying it's warranted. Announcing "this will take a while" for
            something that finishes in four seconds is worse than saying nothing.
          */}
          <p className="mt-0.5 truncate text-[11px] leading-relaxed text-neutral-500">
            {longHaulEta !== null
              ? `${opener} Give me ${formatEta(longHaulEta)} to go through it — everything already loaded is playable right now.`
              : (sync.message ?? "Discogs allows 60 requests a minute, so this takes a moment.")}
          </p>

          {sync.total > 0 && (
            <div className="mt-2 flex items-center gap-2.5">
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-ink-700"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Collection sync"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right font-mono text-[11px] tabular-nums text-neutral-400">
                {percent}%
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
