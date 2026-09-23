/**
 * What the beat meter draws, and what it says while it waits.
 *
 * The meter shows the detector's own onset signal — the kick-weighted rise in
 * low-end energy it computes 125 times a second anyway. Not a separate
 * spectrum analyser, for two reasons. It costs nothing: no second FFT, no
 * second audio graph. And it is honest: the streaks you see are exactly the
 * evidence the BPM is being computed from, so when the meter is flat the
 * reading is guessing, and when the kicks march past in a steady row the
 * reading is about to lock. A prettier visualiser drawn from different data
 * could look confident while the estimate was not.
 *
 * Pure functions only, so the arithmetic is testable and the component that
 * uses them is just a canvas and an animation frame.
 */

import type { OnsetSample } from "./useTempoDetector";

/** Seconds of history on screen. Three is about six beats at 120. */
export const METER_SPAN_SECONDS = 3;
/** Streaks across the meter. Enough to see a kick pattern, few enough to stay lean. */
export const METER_BARS = 48;

/**
 * Collapse the recent onset signal into bars, oldest first.
 *
 * Each bar keeps the *largest* sample in its slice rather than the average:
 * a kick is a spike a few samples wide, and averaging it against the silence
 * around it is exactly how a beat meter ends up looking like a flat hum.
 *
 * Walks the buffer backwards and stops at the first sample older than the
 * window, so the cost is the few hundred samples on screen, not the whole
 * sixteen-second buffer.
 */
export function bucketOnsets(
  samples: readonly OnsetSample[],
  now: number,
  bars: number = METER_BARS,
  span: number = METER_SPAN_SECONDS,
): number[] {
  const out = new Array<number>(bars).fill(0);
  if (bars <= 0 || span <= 0) return out;

  const start = now - span;
  const width = span / bars;

  for (let i = samples.length - 1; i >= 0; i--) {
    const sample = samples[i]!;
    if (sample.t < start) break;
    if (sample.t > now) continue;
    const index = Math.min(bars - 1, Math.floor((sample.t - start) / width));
    if (sample.v > out[index]!) out[index] = sample.v;
  }
  return out;
}

/**
 * A running peak that falls slowly, so the meter scales itself.
 *
 * Tab capture and a laptop microphone differ in level by an order of
 * magnitude; a fixed scale would pin one at the ceiling and leave the other
 * invisible. Rising instantly and decaying over about two seconds means a
 * loud drop does not flatten the quiet breakdown after it for long.
 */
export const PEAK_DECAY_PER_FRAME = 0.985;
const PEAK_FLOOR = 1e-3;

export function nextPeak(previous: number, frameMax: number, decay = PEAK_DECAY_PER_FRAME): number {
  return Math.max(frameMax, previous * decay, PEAK_FLOOR);
}

/**
 * Heights in 0–1. Square-rooted, so hats and snares still register beside the
 * kick instead of vanishing under it — they are what separates a tempo from
 * its double, and a meter that only showed kicks would hide that.
 */
export function scaleBars(bars: readonly number[], peak: number): number[] {
  const safe = peak > 0 ? peak : PEAK_FLOOR;
  return bars.map((value) => Math.sqrt(Math.min(1, Math.max(0, value) / safe)));
}

/** Seconds of audio buffered so far, from the samples' own clock. */
export function bufferedSeconds(samples: readonly OnsetSample[]): number {
  if (samples.length < 2) return 0;
  return samples[samples.length - 1]!.t - samples[0]!.t;
}

export function warmupProgress(samples: readonly OnsetSample[], required: number): number {
  if (required <= 0) return 1;
  return Math.min(1, bufferedSeconds(samples) / required);
}

/**
 * What the detector is doing, in words.
 *
 *   warming   not enough audio for a first estimate yet
 *   reading   enough audio; the first estimate is on its way
 *   live      a rolling estimate exists but has not held steady
 *   locked    a reading held long enough to be saved
 *
 * This is the state that used to be invisible. For the first eight seconds
 * the old panel showed "no BPM yet" — identical to not listening at all.
 */
export type MeterPhase = "warming" | "reading" | "live" | "locked";

export function meterPhase(
  progress: number,
  hasLive: boolean,
  hasCommitted: boolean,
): MeterPhase {
  if (hasCommitted) return "locked";
  if (hasLive) return "live";
  return progress >= 1 ? "reading" : "warming";
}

export function warmupLabel(samples: readonly OnsetSample[], required: number): string {
  const left = Math.max(0, Math.ceil(required - bufferedSeconds(samples)));
  return left > 0 ? `listening · ${left}s` : "reading the beat…";
}
