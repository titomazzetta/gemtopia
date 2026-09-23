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

/**
 * How hard the faders have to work — the second question after "does it fit".
 *
 * ±8% is a ceiling, not a working range. The closed form above assumes both
 * decks can be pushed all the way, one flat out and the other fully down, and
 * in a real booth that almost never happens: records live in roughly the
 * middle third of the fader, and a transition run at the extremes of both is
 * one you will hear. So a pair that technically fits at ±7.6% each is not the
 * same kind of "mixes" as one that needs ±1.5%, and treating them as one
 * green light made the check read far more permissive than DJs actually are.
 *
 *   easy     each deck moves at most half its range. Green.
 *   pushed   fits, but past half — doable, audible. Amber.
 *   out      beyond your range entirely. Red.
 *
 * Kept as its own field rather than folded into `verdict`, because the two
 * answer different questions: verdict says *how* the records meet (1:1,
 * double-time, half-time) and strain says *how much it costs*. A double-time
 * blend can be easy; a straight 1:1 can be pushed.
 */
export type MixStrain = "easy" | "pushed" | "out" | "unknown";

/**
 * Where "easy" ends, as a fraction of the pitch range.
 *
 * Half, because that is where the comfortable middle of a pitch fader runs
 * out in practice — on a 1200 it keeps both decks within ±4%, which is the
 * range most blends actually live in. A named constant so it can be tuned
 * against real sets without hunting for a bare 0.5.
 */
export const COMFORT_FRACTION = 0.5;

export function strainFor(
  requiredPercent: number | null,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): MixStrain {
  if (requiredPercent === null || !Number.isFinite(requiredPercent)) return "unknown";
  // The same epsilon checkMix uses, so a pair on the boundary lands in the
  // same tier here as it does in the verdict.
  if (requiredPercent <= pitchPercent * COMFORT_FRACTION + 0.0001) return "easy";
  if (requiredPercent <= pitchPercent + 0.0001) return "pushed";
  return "out";
}

export interface MixCheck {
  verdict: MixVerdict;
  /** How hard both faders have to work. See `MixStrain`. */
  strain: MixStrain;
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
    strain: "unknown",
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

  const strain = strainFor(bestRequired, pitchPercent);

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
          }${strain === "pushed" ? " — near the edge of the fader" : ""}`;

  return {
    verdict,
    strain,
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

/**
 * The easy part of `mixableWindow`: tempos you can meet without either fader
 * going past half its travel. Same asymmetric formula, half the range.
 */
export function comfortableWindow(
  bpm: number,
  pitchPercent: number = DEFAULT_PITCH_PERCENT,
): { low: number; high: number } {
  return mixableWindow(bpm, pitchPercent * COMFORT_FRACTION);
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

/**
 * Colour follows strain, not verdict. Verdict still supplies the words
 * ("Double-time", "Won't mix") — the colour answers the question a DJ scans
 * for first, which is whether this is going to be comfortable.
 */
export const STRAIN_META: Record<
  MixStrain,
  { label: string; tone: "good" | "warn" | "bad" | "muted" }
> = {
  easy: { label: "Comfortable", tone: "good" },
  pushed: { label: "Pushing it", tone: "warn" },
  out: { label: "Out of range", tone: "bad" },
  unknown: { label: "No BPM", tone: "muted" },
};

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

/* ------------------------------------------------------------------ */
/* Set length                                                          */
/* ------------------------------------------------------------------ */

/** Default crossfade allowance, in seconds. A typical beatmatched blend. */
export const DEFAULT_TRANSITION_SECONDS = 30;

/** The range the UI offers. Below 20s is a cut; above 50s is a long blend. */
export const TRANSITION_RANGE = { min: 0, max: 90 } as const;

export interface SetLength {
  /** Sum of every known track runtime, in seconds. */
  rawSeconds: number;
  /** Runtime minus the overlap of each transition. What the set actually runs. */
  playedSeconds: number;
  /** Tracks in the playlist. */
  trackCount: number;
  /** How many of those have a known runtime. */
  timedCount: number;
  /**
   * True when some tracks have no runtime, so the total is a floor rather than
   * an estimate. Saying "1h 12m" when a fifth of the set is unmeasured is a
   * worse answer than saying "at least 1h 12m".
   */
  partial: boolean;
}

/**
 * How long this set will actually run.
 *
 * Two records that mix for 30 seconds occupy 30 seconds of the night once, not
 * twice — the overlap is shared. So the played length is the sum of runtimes
 * minus one transition per *gap*, of which there are n−1, never n. Getting that
 * off by one is a whole track's worth of error across a long set.
 *
 * `transitionSeconds` is what a DJ actually blends for: near zero when cutting
 * between tracks, 20–50 for a normal beatmatched blend, longer for the sort of
 * set where two records sit together for a minute. It is a per-user setting
 * because it is a stylistic choice, not a constant.
 *
 * Each gap's overlap is also clamped to the shorter of the two records it
 * joins. You cannot blend for 45 seconds out of a 40-second interlude — the
 * record ends first. A flat `transition x gaps` subtraction ignores that and
 * quietly over-shortens any set containing short tracks, which is exactly the
 * set where the total matters most.
 */
export function setLength(
  durations: Array<number | null | undefined>,
  transitionSeconds: number = DEFAULT_TRANSITION_SECONDS,
): SetLength {
  const timed = durations.filter(
    (d): d is number => typeof d === "number" && Number.isFinite(d) && d > 0,
  );

  const rawSeconds = timed.reduce((sum, d) => sum + d, 0);

  const requested = Math.max(0, transitionSeconds);

  // n−1 gaps, not n. A single track has no transition at all. Each gap takes
  // the requested blend, or the shorter adjacent record if that is less.
  let overlap = 0;
  for (let i = 1; i < durations.length; i += 1) {
    const previous = durations[i - 1];
    const next = durations[i];
    const bound = Math.min(
      typeof previous === "number" && previous > 0 ? previous : Infinity,
      typeof next === "number" && next > 0 ? next : Infinity,
    );
    overlap += Number.isFinite(bound) ? Math.min(requested, bound) : requested;
  }

  return {
    rawSeconds,
    playedSeconds: Math.max(0, rawSeconds - overlap),
    trackCount: durations.length,
    timedCount: timed.length,
    partial: timed.length < durations.length,
  };
}

/** "1h 24m", "48m", "0m" — set lengths, not track times. */
export function formatSetLength(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  // 59m30s rounding to 60m should read as the next hour, not "0h 60m".
  if (minutes === 60) return `${hours + 1}h`;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/* ------------------------------------------------------------------ */
/* Pitch-range commentary                                              */
/* ------------------------------------------------------------------ */

/**
 * A remark about the pitch range you picked, or null for the standard.
 *
 * ±8 gets nothing. It is what almost everyone is playing on, and a tool that
 * comments on the normal case is a tool that talks too much — the joke has to
 * be rare to land at all. Everything else is a deliberate choice, and a
 * deliberate choice is worth acknowledging.
 *
 * These are read by strangers, not just the author: a public repo, and DJs the
 * app gets shared with. Playful, never at the user's expense, and nothing that
 * would be awkward on a screen-share in front of an employer or a booker.
 */
export function pitchQuip(percent: number): string | null {
  if (percent === DEFAULT_PITCH_PERCENT) return null;

  if (percent <= 2) return "Practically locked. Bold.";
  if (percent < 6) return "That's a narrow window. Trusting your pressings.";
  if (percent === 6) return "CDJ tight. Every transition earns it.";
  if (percent <= 10) return "A little extra rope. Sensible.";
  if (percent <= 16) return "Sixteen percent is a lot of runway. Wow, how niche.";
  if (percent <= 25) return "At this range you're renegotiating the key too.";
  if (percent <= 50) return "That isn't pitch, that's time travel.";
  return "Beyond here it isn't really the same record any more.";
}

/* ------------------------------------------------------------------ */
/* Displaying a tempo                                                  */
/* ------------------------------------------------------------------ */

/**
 * A tempo, formatted for reading.
 *
 * Two questions get conflated here, and they have different answers.
 *
 * **What do we store?** One decimal, and no coarser. A record pressed at 123.7
 * really is 123.7, and the difference between 123.7 and 124 is 0.24% — which
 * over a five-minute record is about three quarters of a second of drift.
 * Audible, and exactly the drift a DJ is riding the pitch fader to correct.
 * Quantising to whole numbers, or to a 0.5 grid, throws that away for nothing:
 * records are not pressed on a grid, so a grid is a fiction that makes two
 * genuinely different tempos look identical. Every mixability calculation in
 * this file reads the stored value, not this one.
 *
 * **What do we show?** Depends where. Scanning a list of forty records to
 * order a set, the decimal is noise — you are asking "is this a 124 or a 130",
 * and a column of `123.7 / 128.0 / 131.4` is harder to read than `124 / 128 /
 * 131` for no gain. Looking at one track, the decimal is the useful part.
 *
 * Hence a flag rather than one rule. `precise` for the now-playing readout and
 * the dig drawer; the default everywhere a list is being scanned.
 *
 * Detection uncertainty is also real — a reading from a 14-second window is
 * good to a few tenths, not to a hundredth — which is a second reason not to
 * render more precision than one decimal anywhere.
 */
export function formatBpm(
  bpm: number | null | undefined,
  { precise = false }: { precise?: boolean } = {},
): string {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm)) return "—";
  if (!precise) return String(Math.round(bpm));

  const rounded = Math.round(bpm * 10) / 10;
  // "124" rather than "124.0": a trailing zero claims precision the reading
  // does not have, and it is the thing that makes a column look untidy.
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
