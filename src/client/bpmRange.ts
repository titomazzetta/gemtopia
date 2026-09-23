/**
 * Which octave a detected tempo should be reported in.
 *
 * Tempo detection hears a pulse, not a convention. A jungle record at 174 and
 * the same record counted at 87 are the same onsets; so are a dubstep tune at
 * 140 and at 70. Which number a DJ means depends on the genre, and the
 * estimator cannot know the genre — but Discogs does, per release.
 *
 * So the fold window is chosen in two layers:
 *
 *   1. The record's genre pocket, when its Discogs styles identify one.
 *      Narrow, confident, and allowed to overrule a stronger-looking peak.
 *
 *   2. Otherwise, your own range — 70 to 160 unless you change it.
 *
 * ── The trade-off in 70–160, stated plainly ──────────────────────────────
 *
 * 160 sits below drum & bass. A DnB record Discogs has not tagged as such
 * will be reported at half-time: 87, not 174. Tagged ones are unaffected,
 * because the pocket takes over, and most DnB on Discogs is tagged. The
 * previous built-in window was 82–176, which caught untagged DnB and pushed
 * 70–80 BPM downtempo up to 140–160 instead. Every window makes someone count
 * double; this one favours slow music, and ÷2 / ×2 settles either case in one
 * press.
 */

import type { FoldWindow } from "./tempo";

export interface TempoRange {
  low: number;
  high: number;
}

/** The estimator searches 60–200; a window outside that can never be reached. */
export const RANGE_FLOOR = 60;
export const RANGE_CEILING = 200;
/** Narrower than this is a typo, not a preference. */
export const MIN_RANGE_SPAN = 10;

export const DEFAULT_RANGE: TempoRange = { low: 70, high: 160 };

/**
 * Tidy a range someone typed. Clamps into what the estimator can report,
 * swaps a reversed pair rather than rejecting it, and refuses only a span too
 * narrow to mean anything — returning null so the caller keeps the last good
 * value instead of silently inventing one.
 */
export function normaliseRange(low: number, high: number): TempoRange | null {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const clamp = (n: number) => Math.min(RANGE_CEILING, Math.max(RANGE_FLOOR, Math.round(n)));
  const a = clamp(low);
  const b = clamp(high);
  const range = a <= b ? { low: a, high: b } : { low: b, high: a };
  return range.high - range.low >= MIN_RANGE_SPAN ? range : null;
}

/* ------------------------------------------------------------------ */
/* Genre pockets                                                       */
/* ------------------------------------------------------------------ */

export interface Pocket extends TempoRange {
  /** Human name for the UI, e.g. "Drum n Bass". */
  name: string;
}

/**
 * Where each style is *counted*, which is not always where it is felt.
 *
 * Dubstep is counted at 140 though it moves like 70; drum & bass at 174
 * though the snare pattern describes 87. These are DJ conventions, and they
 * are what the number in the catalogue has to match for the mix check to
 * give the right answer.
 *
 * Keyed on Discogs style names. A name here that Discogs never uses costs
 * nothing — it simply never matches.
 */
const POCKETS: Array<{ name: string; low: number; high: number; styles: string[] }> = [
  { name: "Drum n Bass", low: 160, high: 180, styles: ["Drum n Bass", "Jungle", "Darkstep", "Techstep", "Liquid Funk", "Neurofunk"] },
  { name: "Footwork", low: 155, high: 165, styles: ["Footwork", "Juke"] },
  { name: "Hardcore", low: 150, high: 200, styles: ["Hardcore", "Happy Hardcore", "Gabber", "Hardstyle"] },
  { name: "Dubstep", low: 135, high: 145, styles: ["Dubstep", "Grime"] },
  { name: "Trance", low: 125, high: 150, styles: ["Trance", "Progressive Trance", "Psy-Trance", "Goa Trance", "Hard Trance"] },
  { name: "UK Garage", low: 125, high: 140, styles: ["UK Garage", "Speed Garage", "2-Step", "Bassline", "UK Funky"] },
  { name: "Breaks", low: 120, high: 140, styles: ["Breakbeat", "Breaks", "Nu Skool Breaks"] },
  { name: "Techno", low: 115, high: 150, styles: ["Techno", "Minimal", "Minimal Techno", "Dub Techno", "Hard Techno", "Acid"] },
  { name: "House", low: 115, high: 132, styles: ["House", "Deep House", "Tech House", "Acid House", "Progressive House", "Garage House", "Electro House", "Afro House"] },
  { name: "Electro", low: 110, high: 135, styles: ["Electro"] },
  { name: "Amapiano", low: 108, high: 118, styles: ["Amapiano"] },
  { name: "Disco", low: 105, high: 135, styles: ["Disco", "Nu-Disco", "Italo-Disco", "Boogie", "Hi NRG", "Euro-Disco"] },
  { name: "Afrobeat", low: 100, high: 125, styles: ["Afrobeat"] },
  { name: "Balearic", low: 95, high: 120, styles: ["Balearic"] },
  { name: "Funk", low: 90, high: 120, styles: ["Funk", "P.Funk"] },
  { name: "Dancehall", low: 88, high: 105, styles: ["Dancehall", "Ragga"] },
  { name: "Hip Hop", low: 80, high: 100, styles: ["Boom Bap", "Hip Hop", "Instrumental Hip Hop"] },
  { name: "Downtempo", low: 70, high: 100, styles: ["Downtempo", "Trip Hop", "Abstract"] },
  { name: "Roots", low: 65, high: 85, styles: ["Roots Reggae", "Dub", "Rocksteady", "Lovers Rock"] },
];

/**
 * Genres broad enough to be useless as tempo evidence on their own, except
 * these two, which Discogs uses as a genre and whose tempo range is narrow
 * enough to act on when no style says anything more specific.
 */
const GENRE_FALLBACKS: Record<string, string> = {
  "hip hop": "Hip Hop",
  reggae: "Roots",
};

const key = (value: string) => value.trim().toLowerCase();

const BY_STYLE = new Map<string, (typeof POCKETS)[number]>();
for (const pocket of POCKETS) {
  for (const style of pocket.styles) BY_STYLE.set(key(style), pocket);
}

/**
 * The tempo pocket a release's Discogs styles point to, or null.
 *
 * When styles disagree — a "Deep House, Downtempo" record — the pockets are
 * merged, but only if the merge is still **narrower than an octave**. That
 * is the whole test, and it is not arbitrary: a window narrower than an
 * octave can contain at most one octave of any tempo, so folding into it is
 * unambiguous. A wider merge ("Drum n Bass, Downtempo" spans 70–180) could
 * fold the same reading two ways, so it says nothing and the caller falls back
 * to your own range.
 */
export function pocketFor(styles: readonly string[], genres: readonly string[]): Pocket | null {
  const matched: Array<(typeof POCKETS)[number]> = [];
  for (const style of styles) {
    const hit = BY_STYLE.get(key(style));
    if (hit && !matched.includes(hit)) matched.push(hit);
  }

  if (matched.length === 0) {
    for (const genre of genres) {
      const name = GENRE_FALLBACKS[key(genre)];
      const hit = name ? POCKETS.find((p) => p.name === name) : undefined;
      if (hit && !matched.includes(hit)) matched.push(hit);
    }
  }

  if (matched.length === 0) return null;

  const low = Math.min(...matched.map((p) => p.low));
  const high = Math.max(...matched.map((p) => p.high));
  if (high / low >= 2) return null;

  return { name: matched.slice(0, 2).map((p) => p.name).join(" / "), low, high };
}

/**
 * The window the estimator should fold into.
 *
 * A genre pocket gets a relaxed evidence bar (0.5 rather than 0.85): once the
 * record's own tag says how it is counted, an octave that scores half as well
 * as the peak is the same pulse described the right way, not a weaker guess.
 * It is not zero — an octave with almost no comb support at all means the
 * reading is off, and the tag should not paper over that.
 */
export const POCKET_SCORE_RATIO = 0.5;
export const RANGE_SCORE_RATIO = 0.85;

export function foldWindow(range: TempoRange, pocket: Pocket | null): FoldWindow {
  return pocket
    ? { low: pocket.low, high: pocket.high, minScoreRatio: POCKET_SCORE_RATIO }
    : { low: range.low, high: range.high, minScoreRatio: RANGE_SCORE_RATIO };
}
