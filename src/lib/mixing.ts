/**
 * Mixability: can these two records be beatmatched on your decks?
 *
 * Not server-only — the playlist view runs this on every adjacent pair as you
 * reorder, so it has to be a pure function the browser can call freely.
 *
 * ── The physics ─────────────────────────────────────────────────────────────
 *
 * A turntable's pitch fader is a *percentage*, not a BPM offset. A Technics
 * SL-1200 does ±8%, so a 124 BPM record plays anywhere from 114.1 to 133.9.
 * That is why "±8" cannot be implemented as "within 8 BPM": at 90 BPM ±8% is
 * ±7.2 BPM, and at 174 it is ±13.9.
 *
 * The other half — the part that is easy to get wrong — is that **both decks
 * have a pitch fader**. You are not obliged to hold the outgoing record at zero
 * and drag the incoming one to meet it. Pull one up, push the other down, meet
 * in the middle, and you cover far more ground than a naive one-sided check
 * suggests.
 *
 * Two records at A and B BPM can meet if there is some tempo both can reach:
 *
 *     A·(1 + x) = B·(1 − x)      for some pitch fraction x ≤ range
 *
 * Solving for x gives a closed form:
 *
 *     x = |B − A| / (A + B)
 *
 * and the tempo they meet at is A·(1 + x) = 2AB/(A + B) — the harmonic mean of
 * the two tempos. So the whole test is one subtraction and one division:
 * **they mix if |B − A| / (A + B) ≤ range.**
 *
 * Worked: 124 and 128 → x = 4/252 = 1.59%. Both decks move 1.59%, meeting at
 * 126.0. Comfortably inside ±8, and inside ±2 for that matter.
 *
 * Worked: 124 and 140 → x = 16/264 = 6.06%. Still fits on a 1200, but you are
 * running one record 6% fast and the other 6% slow, which you will hear.
 *
 * ── Half and double time ────────────────────────────────────────────────────
 *
 * An 87 BPM record and a 174 BPM record share a beat grid at 2:1 with no pitch
 * change at all — you just count it double-time. So every pair is tested at
 * three ratios (1:1, 2:1, 1:2) and the cheapest fit wins.
 */

export type MixVerdict =
  /** Beatmatches at 1:1 inside your pitch range. */
  | "direct"
  /** The incoming record is roughly half the tempo; count it double-time. */
  | "double-time"
  /** The incoming record is roughly twice the tempo; count it half-time. */
  | "half-time"
  /** Won't fit on your decks, but would on a wider pitch range. */
  | "stretch"
  /** No pitch range on any normal deck bridges this. */
  | "impossible"
  /** One or both tempos aren't catalogued yet. */
  | "unknown";

export interface MixCheck {
  verdict: MixVerdict;
  /** Multiplier applied to the incoming record's BPM to make the comparison. */
  ratio: 1 | 2 | 0.5;
  /** Tempo both records can meet at — the harmonic mean. */
  meetBpm: number | null;
  /**
   * Pitch each deck needs, as a signed percentage, meeting in the middle.
   * `outgoing` is what's playing; `incoming` is what comes next.
   */
  outgoingPitch: number | null;
  incomingPitch: number | null;
  /**
   * Pitch the incoming record alone would need if you hold the outgoing one
   * at zero — the stricter, more common way to do it live.
   */
  incomingOnlyPitch: number | null;
  /** Smallest symmetric pitch range (%) that makes this transition possible. */
  requiredPercent: number | null;
  /** One line a DJ can read at a glance. */
  summary: string;
}

/* ------------------------------------------------------------------ */
/* Deck presets                                                        */
/* ------------------------------------------------------------------ */

export interface DeckPreset {
  id: string;
  label: string;
  percent: number;
  note?: string;
}

/**
 * Real pitch ranges from real gear. The SL-1200 is the default because it is
 * the one every club has and the one most DJs learned on.
 */
export const DECK_PRESETS: DeckPreset[] = [
  { id: "sl1200", label: "Technics SL-1200 / 1210", percent: 8, note: "Club standard" },
  { id: "cdj-6", label: "Pioneer CDJ (±6)", percent: 6, note: "Tightest" },
  { id: "cdj-10", label: "Pioneer CDJ (±10)", percent: 10 },
  { id: "wide-16", label: "SL-1200MK7 / PLX / CDJ wide (±16)", percent: 16 },
  { id: "wide-50", label: "Wide (±50)", percent: 50, note: "Digital / keylock" },
];

export const DEFAULT_PITCH_PERCENT = 8;
export const MIN_PITCH_PERCENT = 1;
export const MAX_PITCH_PERCENT = 100;

/**
 * Above this, "stretch" stops being a useful category — nothing on a normal
 * deck reaches it, and the transition is a different technique entirely.
 */
const STRETCH_CEILING_PERCENT = 16;

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

/** Symmetric pitch each deck needs to meet in the middle, as a percentage. */
export function requiredPitchPercent(a: number, b: number): number {
  if (a <= 0 || b <= 0) return Infinity;
  return (Math.abs(b - a) / (a + b)) * 100;
}

/** The tempo two records meet at when both pitch equally: the harmonic mean. */
export function meetingBpm(a: number, b: number): number {
  return (2 * a * b) / (a + b);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function checkMix(
  outgoingBpm: number | null,
  incomingBpm: number | null,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): MixCheck {
  const unknown: MixCheck = {
    verdict: "unknown",
    ratio: 1,
    meetBpm: null,
    outgoingPitch: null,
    incomingPitch: null,
    incomingOnlyPitch: null,
    requiredPercent: null,
    summary: "BPM not catalogued",
  };

  if (
    outgoingBpm === null ||
    incomingBpm === null ||
    outgoingBpm <= 0 ||
    incomingBpm <= 0
  ) {
    return unknown;
  }

  // Try the natural tempo first, then the double- and half-time readings, and
  // keep whichever needs the least pitch. Ordering matters only for ties:
  // a 1:1 fit is always preferable to a 2:1 one at the same cost.
  const candidates: Array<{ ratio: 1 | 2 | 0.5; effective: number }> = [
    { ratio: 1, effective: incomingBpm },
    { ratio: 2, effective: incomingBpm * 2 },
    { ratio: 0.5, effective: incomingBpm / 2 },
  ];

  let best = candidates[0]!;
  let bestRequired = requiredPitchPercent(outgoingBpm, best.effective);

  for (const candidate of candidates.slice(1)) {
    const required = requiredPitchPercent(outgoingBpm, candidate.effective);
    if (required < bestRequired - 0.0001) {
      best = candidate;
      bestRequired = required;
    }
  }

  const meet = meetingBpm(outgoingBpm, best.effective);
  const outgoingPitch = (meet / outgoingBpm - 1) * 100;
  const incomingPitch = (meet / best.effective - 1) * 100;
  const incomingOnlyPitch = (outgoingBpm / best.effective - 1) * 100;

  const fits = bestRequired <= pitchPercent + 0.0001;

  const verdict: MixVerdict = fits
    ? best.ratio === 1
      ? "direct"
      : best.ratio === 2
        ? "double-time"
        : "half-time"
    : bestRequired <= STRETCH_CEILING_PERCENT
      ? "stretch"
      : "impossible";

  const ratioNote =
    best.ratio === 2
      ? " at double-time"
      : best.ratio === 0.5
        ? " at half-time"
        : "";

  const summary =
    verdict === "impossible"
      ? `No overlap — would need ±${round1(bestRequired)}%`
      : verdict === "stretch"
        ? `Needs ±${round1(bestRequired)}% — wider than your ±${pitchPercent}%`
        : `Meet at ${round1(meet)}${ratioNote} · ${
            Math.abs(outgoingPitch) < 0.05
              ? "no pitch needed"
              : `±${round1(Math.abs(outgoingPitch))}% each`
          }`;

  return {
    verdict,
    ratio: best.ratio,
    meetBpm: round1(meet),
    outgoingPitch: round1(outgoingPitch),
    incomingPitch: round1(incomingPitch),
    incomingOnlyPitch: round1(incomingOnlyPitch),
    requiredPercent: round1(bestRequired),
    summary,
  };
}

/* ------------------------------------------------------------------ */
/* Windows and sequences                                               */
/* ------------------------------------------------------------------ */

/**
 * Every tempo a record at `bpm` can be mixed with, given both decks can pitch.
 *
 * The bound is *not* `bpm ± range`. Solving |B − A|/(A + B) ≤ p for B gives
 *
 *     B ∈ [ A·(1 − p)/(1 + p) ,  A·(1 + p)/(1 − p) ]
 *
 * which at ±8% turns 124 BPM into 105.6–145.7 — a good deal more of the crate
 * than the 114–134 a one-sided reading would suggest.
 */
export function mixableWindow(
  bpm: number,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): { low: number; high: number } {
  const p = pitchPercent / 100;
  return {
    low: round1((bpm * (1 - p)) / (1 + p)),
    high: round1((bpm * (1 + p)) / (1 - p)),
  };
}

export interface SequenceStep {
  /** Index of the incoming track in the playlist. */
  index: number;
  check: MixCheck;
}

export interface SequenceReport {
  steps: SequenceStep[];
  direct: number;
  timeShifted: number;
  stretch: number;
  impossible: number;
  unknown: number;
  /** Indices whose transition from the previous track will not work. */
  problemIndices: number[];
}

/** Run the check across a playlist in order. */
export function analyseSequence(
  bpms: Array<number | null>,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): SequenceReport {
  const steps: SequenceStep[] = [];
  let direct = 0;
  let timeShifted = 0;
  let stretch = 0;
  let impossible = 0;
  let unknown = 0;
  const problemIndices: number[] = [];

  for (let i = 1; i < bpms.length; i++) {
    const check = checkMix(bpms[i - 1] ?? null, bpms[i] ?? null, pitchPercent);
    steps.push({ index: i, check });

    switch (check.verdict) {
      case "direct":
        direct += 1;
        break;
      case "double-time":
      case "half-time":
        timeShifted += 1;
        break;
      case "stretch":
        stretch += 1;
        problemIndices.push(i);
        break;
      case "impossible":
        impossible += 1;
        problemIndices.push(i);
        break;
      default:
        unknown += 1;
    }
  }

  return { steps, direct, timeShifted, stretch, impossible, unknown, problemIndices };
}

/**
 * Reorder so consecutive tracks mix.
 *
 * Nearest-neighbour from the slowest known tempo: repeatedly take whichever
 * remaining track needs the least pitch from the one just placed. Not optimal
 * — this is the travelling-salesman problem wearing a hat — but it is O(n²) on
 * playlists of a few dozen records, it is stable, and it produces the gradual
 * upward drift a set usually wants.
 *
 * Tracks with no catalogued BPM keep their relative order and are appended at
 * the end rather than being silently dropped into the middle of a run.
 */
export function smoothOrder(
  bpms: Array<number | null>,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): number[] {
  const known: number[] = [];
  const unknownIdx: number[] = [];

  bpms.forEach((bpm, i) => {
    if (bpm === null || bpm <= 0) unknownIdx.push(i);
    else known.push(i);
  });

  if (known.length === 0) return [...unknownIdx];

  known.sort((a, b) => (bpms[a] as number) - (bpms[b] as number));

  const remaining = new Set(known);
  const order: number[] = [];

  let current = known[0]!;
  remaining.delete(current);
  order.push(current);

  while (remaining.size > 0) {
    let bestIndex = -1;
    let bestCost = Infinity;

    for (const candidate of remaining) {
      const check = checkMix(
        bpms[current] as number,
        bpms[candidate] as number,
        pitchPercent,
      );
      // Prefer a fit; among fits, prefer the smallest pitch move. A ratio
      // change is a real gear shift in a set, so it carries a small penalty.
      const penalty = check.ratio === 1 ? 0 : 1.5;
      const cost = (check.requiredPercent ?? Infinity) + penalty;

      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = candidate;
      }
    }

    if (bestIndex === -1) break;
    remaining.delete(bestIndex);
    order.push(bestIndex);
    current = bestIndex;
  }

  // Anything unreachable, then the un-catalogued tracks.
  for (const index of remaining) order.push(index);
  return [...order, ...unknownIdx];
}

/* ------------------------------------------------------------------ */
/* Presentation                                                        */
/* ------------------------------------------------------------------ */

export const VERDICT_META: Record<
  MixVerdict,
  { label: string; short: string; tone: "good" | "shift" | "warn" | "bad" | "muted" }
> = {
  direct: { label: "Mixes", short: "○", tone: "good" },
  "double-time": { label: "Double-time", short: "×2", tone: "shift" },
  "half-time": { label: "Half-time", short: "÷2", tone: "shift" },
  stretch: { label: "Out of range", short: "!", tone: "warn" },
  impossible: { label: "Won't mix", short: "✕", tone: "bad" },
  unknown: { label: "No BPM", short: "–", tone: "muted" },
};
