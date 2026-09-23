"use client";

import { useEffect, useRef, useState } from "react";
import { WARMUP_SECONDS, type OnsetSample } from "@/client/useTempoDetector";
import {
  bucketOnsets,
  meterPhase,
  nextPeak,
  scaleBars,
  warmupLabel,
  warmupProgress,
} from "@/client/beatMeter";

type Peek = () => { samples: readonly OnsetSample[]; now: number } | null;

/**
 * Streaks that jump with the kick while detection listens.
 *
 * Draws the detector's own onset signal, so what you see is literally what
 * the BPM is being computed from — see client/beatMeter.ts. A canvas driven by
 * `requestAnimationFrame` rather than React state: sixty updates a second
 * through state would re-render the whole transport to move a few lines.
 *
 * The words underneath change on a slow timer, four times a second, which is
 * all a countdown needs.
 *
 * Reduced motion: the streaks redraw four times a second instead of sixty. It
 * still shows that something is being heard, which is the point, without the
 * constant movement.
 */
export function BeatMeter({
  peek,
  liveBpm,
  liveConfidence,
  locked,
}: {
  peek: Peek;
  liveBpm: number | null;
  liveConfidence: number;
  /** A reading has held steady and been saved for this track. */
  locked: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakRef = useRef(0);
  const [status, setStatus] = useState({ progress: 0, label: "listening…" });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minFrameMs = reduce ? 250 : 0;
    let frame = 0;
    let lastDraw = 0;
    // Resolved once: the canvas has no currentColor, so it borrows the
    // element's text colour, which is set by a Tailwind class like the rest
    // of the transport and follows the palette automatically.
    const colour = getComputedStyle(canvas).color || "#5ef08a";

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      if (time - lastDraw < minFrameMs) return;
      lastDraw = time;

      const { width, height } = canvas;
      context.clearRect(0, 0, width, height);

      const data = peek();
      if (!data) return;

      const bars = bucketOnsets(data.samples, data.now);
      peakRef.current = nextPeak(peakRef.current, Math.max(0, ...bars));
      const heights = scaleBars(bars, peakRef.current);

      const slot = width / heights.length;
      const barWidth = Math.max(1, slot * 0.42);
      context.fillStyle = colour;

      heights.forEach((h, i) => {
        // Centred on the midline, like a waveform, so a kick reads as a streak
        // rather than a bar chart. A floor of one pixel keeps silence visible
        // as a line: flat means "hearing nothing", not "not running".
        const barHeight = Math.max(1, h * height);
        context.globalAlpha = 0.22 + 0.78 * h;
        context.fillRect(
          Math.round(i * slot + (slot - barWidth) / 2),
          Math.round((height - barHeight) / 2),
          Math.round(barWidth),
          Math.round(barHeight),
        );
      });
      context.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);

    const words = window.setInterval(() => {
      const data = peek();
      const samples = data?.samples ?? [];
      const next = {
        progress: warmupProgress(samples, WARMUP_SECONDS),
        label: warmupLabel(samples, WARMUP_SECONDS),
      };
      // Most ticks change nothing visible; returning the same object lets
      // React skip the render.
      setStatus((previous) =>
        previous.label === next.label &&
        Math.abs(previous.progress - next.progress) < 0.02
          ? previous
          : next,
      );
    }, 250);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(words);
      observer.disconnect();
    };
  }, [peek]);

  const phase = meterPhase(status.progress, liveBpm !== null, locked);
  const fill =
    phase === "warming" || phase === "reading" ? status.progress : liveConfidence;

  return (
    <div className="mt-1.5">
      <canvas
        ref={canvasRef}
        className="block h-5 w-full text-accent"
        aria-hidden="true"
      />
      <div className="mt-1 flex items-center gap-1.5">
        <div className="h-0.5 flex-1 overflow-hidden rounded-full bg-ink-700">
          <div
            className={`h-full rounded-full transition-[width] ${
              phase === "warming" || phase === "reading" ? "bg-accent/50" : "bg-accent"
            }`}
            style={{ width: `${Math.round(fill * 100)}%` }}
          />
        </div>
        <span className="font-mono text-[9px] text-neutral-500" aria-hidden="true">
          {phase === "warming" || phase === "reading"
            ? status.label
            : phase === "live"
              ? `~${liveBpm} · ${Math.round(liveConfidence * 100)}%`
              : "locked"}
        </span>
      </div>
      {/* The visible text counts down every second, which is fine to look at
          and maddening to hear. A screen reader gets the phase instead, so it
          speaks three times — listening, reading, locked — not ten. */}
      <span className="sr-only" role="status" aria-live="polite">
        {phase === "warming"
          ? "Listening for the beat"
          : phase === "reading"
            ? "Reading the beat"
            : phase === "locked"
              ? "Tempo locked"
              : ""}
      </span>
    </div>
  );
}
