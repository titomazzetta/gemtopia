/**
 * Halving and doubling a tempo reading.
 *
 * This exists because tempo detection cannot tell an octave apart. A jungle
 * record at 170 is heard as 85 about as often as not, and both answers are
 * "correct" in the sense that the onsets line up — the estimator has no way
 * to know which one a DJ means. So the fix is a person pressing ÷2 or ×2,
 * and the only thing the code has to get right is the arithmetic and the
 * limits.
 *
 * Pulled out of CrateApp because the range guard is a *judgement* — 40 to 260
 * — and judgements that live inside a component are judgements nothing can
 * check.
 */

/** The slowest and fastest readings the catalogue will hold. */
export const MIN_BPM = 40;
export const MAX_BPM = 260;

export type ScaleFactor = 0.5 | 2;

export interface ScaleResult {
  /** The new reading, or null when the scale should not be applied. */
  bpm: number | null;
  /** Why it was refused, for the caller to show. Null on success. */
  refusal: string | null;
}

/**
 * Scale a reading, or refuse and say why.
 *
 * Rounds to one decimal place, because that is the precision the catalogue
 * stores and doubling 86.25 should not produce 172.5 in one place and
 * 172.50000000000003 in another.
 *
 * Refuses rather than clamps. Clamping 300 down to 260 would record a tempo
 * nobody measured and nothing would say so — an invented number in a
 * catalogue used to decide whether two records beatmatch is worse than no
 * number at all.
 */
export function scaleReading(
  existing: number | null | undefined,
  factor: ScaleFactor,
): ScaleResult {
  if (existing === null || existing === undefined || !Number.isFinite(existing)) {
    return { bpm: null, refusal: null };
  }

  const scaled = Math.round(existing * factor * 10) / 10;

  if (scaled < MIN_BPM || scaled > MAX_BPM) {
    return {
      bpm: null,
      refusal: `${scaled} would land outside a sensible tempo range.`,
    };
  }

  return { bpm: scaled, refusal: null };
}
