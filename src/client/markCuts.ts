/**
 * The rules behind the Gemtopia mark, kept out of the component that draws it.
 *
 * Partly the usual reason — a pure rule can be tested and a `.tsx` file cannot
 * be imported by the test runner, which strips types but not JSX. Mostly the
 * better one: these numbers are decisions, and decisions that live inside a
 * render function get changed by whoever is adjusting spacing that afternoon.
 */

export type MarkCut = "display" | "text" | "micro";

/**
 * The stone, as one polygon shared by every cut.
 *
 * Declared once because three copies is three chances for the cuts to drift
 * apart into three different logos — which is the specific way a hand-drawn
 * icon set stops being an icon set.
 *
 * Deep proportions: narrow table (23–41 across the top), girdle at y=30,
 * culet at y=62. Chosen over the classic cut because this is a thing you flick
 * through rather than stare at, and the steeper stone is the more distinctive
 * silhouette at a glance.
 */
export const STONE = "23,13 41,13 58,30 32,62 6,30";
export const GIRDLE_Y = 30;
export const CENTRE_X = 32;
export const TABLE_Y = 13;
export const CULET_Y = 62;

/**
 * Where the cuts change hands.
 *
 * 24 rather than 32 because the text cut still holds at 24 on a retina screen,
 * and dropping to the solid earlier spends the facets on sizes that could have
 * shown them. 64 because below it the four extra facets stop being legible and
 * start being noise.
 */
export const MICRO_MAX = 24;
export const DISPLAY_MIN = 64;

/**
 * Pick the drawing for a size.
 *
 * The alternative — one SVG, scaled — is the obvious simplification and it is
 * wrong. A 1.1px hairline reads as intended at 96px and as a grey smudge at
 * 16; a stroke heavy enough to survive 16px looks clumsy on a splash screen.
 * Type foundries solved this with optical sizes and the answer is the same
 * here: draw it more than once.
 */
export function cutForSize(size: number): MarkCut {
  if (size < MICRO_MAX) return "micro";
  if (size >= DISPLAY_MIN) return "display";
  return "text";
}

/**
 * The mark's size beside the wordmark, as a fraction of the type size.
 *
 * A deep brilliant is taller than it is wide, so matching the wordmark's own
 * box makes it loom. At 88% it sits on the same optical line as the cap
 * height. A constant rather than a judgement made per call site, because
 * eyeballing it on each screen is how one logo becomes four.
 */
export const LOCKUP_RATIO = 0.88;
