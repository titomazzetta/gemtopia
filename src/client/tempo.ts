/**
 * Tempo estimation.
 *
 * `estimateTempo` is deliberately pure — it takes a uniformly sampled onset
 * envelope and returns a BPM. No audio APIs, no DOM. That is what makes it
 * unit-testable against synthetic signals (see scripts/test-tempo.mjs), which
 * matters because "the BPM is wrong" is otherwise a miserable thing to debug
 * in a browser at a gig.
 */

export interface TempoEstimate {
  bpm: number;
  /** 0–1. Peak prominence of the winning lag against the rest of the curve. */
  confidence: number;
}

/** Musically sensible search space. Nothing below 60 or above 200 is useful. */
const MIN_BPM = 60;
const MAX_BPM = 200;

/**
 * Where an octave-ambiguous reading gets folded, and how much evidence the
 * fold needs.
 *
 * Comb scoring cannot tell a tempo from its double — 87 and 174 describe the
 * same pulse grid — so the estimator reports its strongest peak and then
 * offers to move it by an exact octave into this window.
 *
 * `minScoreRatio` is the evidence bar for that move: the octave has to score
 * at least this fraction of the winning peak. 0.85 when the window is only a
 * general preference, because then a clearly stronger reading should win.
 * Lower when the window comes from the record's genre: choosing between 87
 * and 174 is then a question of *convention*, not of evidence, and a Discogs
 * "Drum n Bass" tag is better evidence of the convention than the comb score
 * is — which is exactly why DnB used to land on 87 half the time.
 */
export interface FoldWindow {
  low: number;
  high: number;
  minScoreRatio: number;
}

/**
 * Used when a caller states no preference. Dance music sits here. Kept at its
 * original values so every existing reading, and the tests pinning them, mean
 * what they always meant — the app passes its own window explicitly.
 */
export const DEFAULT_FOLD: FoldWindow = { low: 82, high: 176, minScoreRatio: 0.85 };

/**
 * Half-wave rectified difference against a local moving average.
 *
 * Removes the DC component (sustained loudness) so only *increases* in energy
 * — onsets — survive. Without this, a loud pad holds the autocorrelation up
 * and swamps the kick pattern.
 */
export function whiten(envelope: Float32Array, windowSize = 24): Float32Array {
  const out = new Float32Array(envelope.length);
  let sum = 0;
  const queue: number[] = [];

  for (let i = 0; i < envelope.length; i++) {
    const value = envelope[i]!;
    queue.push(value);
    sum += value;
    if (queue.length > windowSize) sum -= queue.shift()!;

    const mean = sum / queue.length;
    out[i] = Math.max(0, value - mean);
  }

  // Normalise to unit peak so confidence is comparable between tracks.
  let peak = 0;
  for (let i = 0; i < out.length; i++) if (out[i]! > peak) peak = out[i]!;
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / peak;

  return out;
}

/**
 * Normalised autocorrelation at every whole-sample lag up to `maxLag`.
 *
 * Computed once per estimate and then reused for every candidate tempo, which
 * is both faster than re-correlating per tempo and — crucially — *unbiased*.
 */
function autocorrelation(signal: Float32Array, maxLag: number): Float32Array {
  const out = new Float32Array(maxLag + 1);

  for (let lag = 0; lag <= maxLag; lag++) {
    const n = signal.length - lag;
    if (n <= 0) break;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += signal[i]! * signal[i + lag]!;
    out[lag] = sum / n;
  }

  return out;
}

/**
 * Read the autocorrelation at a fractional lag.
 *
 * Note carefully *what* is being interpolated: the correlation curve, not the
 * signal. Interpolating the signal was the obvious first implementation and it
 * is wrong — linear interpolation flattens a sharp onset transient, so
 * fractional lags score systematically lower than near-integer ones. A 174 BPM
 * track has a period of 34.48 envelope samples and would lose to its own half
 * tempo at 68.97 (nearly a whole number) every single time. The
 * autocorrelation curve, by contrast, is smooth around its peaks, so
 * interpolating it costs nothing.
 *
 * Both of those failure modes are pinned down by scripts/test-tempo.mjs.
 */
function correlationAt(acf: Float32Array, lag: number): number {
  const i = Math.floor(lag);
  if (i < 0) return 0;
  if (i + 1 >= acf.length) return acf[acf.length - 1] ?? 0;
  const frac = lag - i;
  return acf[i]! * (1 - frac) + acf[i + 1]! * frac;
}

/**
 * Comb-filter score for a candidate beat period.
 *
 * Plain autocorrelation cannot tell a beat from a bar. Summing the correlation
 * at the lag and its 2nd–4th harmonics rewards the lag that is the actual
 * pulse, because a real beat grid has energy at all of them.
 */
function combScore(acf: Float32Array, lag: number): number {
  let total = 0;
  let weightSum = 0;

  for (let multiple = 1; multiple <= 4; multiple++) {
    const offset = lag * multiple;
    if (offset >= acf.length - 1) break;

    // Later harmonics are noisier; weight them down.
    const weight = 1 / multiple;
    total += correlationAt(acf, offset) * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? total / weightSum : 0;
}

/** Resolution of the tempo search, in BPM. */
const BPM_STEP = 0.2;

export function estimateTempo(
  envelope: Float32Array,
  hopSeconds: number,
  fold: FoldWindow = DEFAULT_FOLD,
): TempoEstimate | null {
  if (hopSeconds <= 0) return null;

  // Need enough signal that four beats at the slowest tempo fit inside it.
  const minimumSamples = Math.ceil(((60 / MIN_BPM) * 4) / hopSeconds);
  if (envelope.length < minimumSamples) return null;

  const signal = whiten(envelope);

  // Silence in, nothing out.
  let energy = 0;
  for (let i = 0; i < signal.length; i++) energy += signal[i]!;
  if (energy < signal.length * 0.005) return null;

  // Longest lag we ever ask for: the slowest tempo's period, times the
  // highest comb harmonic.
  const maxLag = Math.min(
    signal.length - 1,
    Math.ceil((60 / MIN_BPM / hopSeconds) * 4),
  );
  const acf = autocorrelation(signal, maxLag);

  // Search directly over tempo rather than over integer lags: the grid is
  // then uniform in the units we care about, and fine enough everywhere.
  const steps = Math.floor((MAX_BPM - MIN_BPM) / BPM_STEP) + 1;
  const scores = new Float32Array(steps);

  let best = -Infinity;
  let bestBpm = 0;
  let sum = 0;

  for (let i = 0; i < steps; i++) {
    const bpm = MIN_BPM + i * BPM_STEP;
    const lag = 60 / (bpm * hopSeconds);
    if (lag * 2 >= signal.length - 1) {
      scores[i] = 0;
      continue;
    }

    const score = combScore(acf, lag);
    scores[i] = score;
    sum += score;

    if (score > best) {
      best = score;
      bestBpm = bpm;
    }
  }

  if (best <= 0 || bestBpm === 0) return null;

  const mean = sum / steps;
  let variance = 0;
  for (let i = 0; i < steps; i++) variance += (scores[i]! - mean) ** 2;
  const stdDev = Math.sqrt(variance / steps);

  /* ---- Octave resolution -------------------------------------------- *
   * The winning lag and its octaves all describe the same pulse. Pick the
   * one that lands where dance music actually lives, but only if it scores
   * nearly as well — never override a clearly stronger reading.            */

  const scoreAt = (bpm: number): number => {
    if (bpm < MIN_BPM || bpm > MAX_BPM) return -Infinity;
    const index = Math.round((bpm - MIN_BPM) / BPM_STEP);
    return scores[index] ?? -Infinity;
  };

  let chosen = bestBpm;
  const inPreferred = (bpm: number) => bpm >= fold.low && bpm <= fold.high;

  if (!inPreferred(chosen)) {
    for (const factor of [2, 0.5, 4, 0.25]) {
      const candidate = bestBpm * factor;
      if (!inPreferred(candidate)) continue;
      if (scoreAt(candidate) >= best * fold.minScoreRatio) {
        chosen = candidate;
        break;
      }
    }
  }

  /* ---- Confidence ---------------------------------------------------- *
   * Two independent measures, and we report the pessimistic one. The
   * z-score catches "the curve is flat"; the peak-to-mean ratio catches
   * "everything correlates a bit", which is what unpulsed noise looks like
   * and which a z-score alone scores far too generously.                   */

  const z = stdDev > 0 ? (best - mean) / stdDev : 0;
  const ratio = mean > 0 ? best / mean : 0;

  const fromZ = (z - 2) / 5;
  const fromRatio = (ratio - 1.25) / 1.1;
  const confidence = Math.max(0, Math.min(1, Math.min(fromZ, fromRatio)));

  return { bpm: Math.round(chosen * 10) / 10, confidence };
}

/* ------------------------------------------------------------------ */
/* Tap tempo                                                           */
/* ------------------------------------------------------------------ */

/**
 * Median-of-intervals tap tempo with outlier rejection.
 *
 * Mean-of-intervals is the naive choice and it is wrong: one fumbled tap drags
 * the average badly. The median ignores it, and intervals more than 40% off
 * the median are discarded outright before the final average — so a missed
 * beat costs you nothing but the tap.
 */
export class TapTempo {
  private taps: number[] = [];
  private static readonly RESET_AFTER_MS = 2_500;
  private static readonly MAX_TAPS = 16;

  /** Register a tap. Returns the current estimate, or null if too few taps. */
  tap(now: number = performance.now()): TempoEstimate | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > TapTempo.RESET_AFTER_MS) {
      this.taps = [];
    }

    this.taps.push(now);
    if (this.taps.length > TapTempo.MAX_TAPS) this.taps.shift();
    if (this.taps.length < 3) return null;

    const intervals: number[] = [];
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i]! - this.taps[i - 1]!);
    }

    const sorted = [...intervals].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[middle - 1]! + sorted[middle]!) / 2
        : sorted[middle]!;

    const kept = intervals.filter(
      (value) => Math.abs(value - median) <= median * 0.4,
    );
    if (kept.length === 0) return null;

    const average = kept.reduce((a, b) => a + b, 0) / kept.length;
    if (average <= 0) return null;

    const bpm = 60_000 / average;
    if (bpm < 40 || bpm > 260) return null;

    // More taps that agree with each other means more confidence.
    const spread =
      kept.reduce((acc, v) => acc + Math.abs(v - average), 0) / kept.length;
    const tightness = Math.max(0, 1 - spread / (average * 0.15));
    const depth = Math.min(1, (kept.length - 1) / 7);

    return {
      bpm: Math.round(bpm * 10) / 10,
      confidence: Math.max(0.5, Math.min(1, 0.5 + 0.5 * tightness * depth)),
    };
  }

  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps = [];
  }
}

/* ------------------------------------------------------------------ */
/* Parsing BPM out of Discogs text                                     */
/* ------------------------------------------------------------------ */

/**
 * Sellers and labels write tempo into track titles and format descriptions
 * surprisingly often — "Track Name (128 BPM)", "133bpm", "@ 174".
 * Free to harvest, so we do.
 */
export function parseBpmFromText(text: string | null | undefined): number | null {
  if (!text) return null;

  const patterns = [
    /(\d{2,3}(?:\.\d)?)\s*bpm\b/i,
    /\bbpm[:\s]+(\d{2,3}(?:\.\d)?)/i,
    /[([]\s*(\d{2,3})\s*bpm\s*[)\]]/i,
    /@\s*(\d{2,3})\s*$/,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value >= 40 && value <= 260) {
      return Math.round(value * 10) / 10;
    }
  }

  return null;
}
