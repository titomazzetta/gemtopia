/**
 * The Gemtopia mark: a brilliant-cut stone with a spindle at its culet.
 *
 * Deep proportions — narrow table, steep pavilion — chosen over the classic
 * cut because this is a thing you flick through rather than stare at, and the
 * steeper stone is the more distinctive silhouette at a glance. The cost is
 * that it is taller than it is wide, which is why `Lockup` sets the mark to
 * 88% of the wordmark's size rather than matching it; a square-mark ratio
 * makes this one loom next to type.
 *
 * Faceted rather than grooved, deliberately. An earlier direction ran
 * concentric record grooves through the stone and read as vinyl first, gem
 * second. This one is quieter: five straight facets, one girdle, one spindle.
 * It gives up the literal vinyl reference to gain a mark that holds its
 * structure down to a favicon and stays out of the way of a screen whose
 * actual job is showing records.
 *
 * ── Three cuts, not one drawing ──────────────────────────────────────────
 *
 * The mark is drawn three times, at weights each size can carry. This is the
 * type-foundry answer to optical sizing, and it is the difference between a
 * logo and an SVG that has been scaled: a stroke that reads as a hairline at
 * 96px is a smudge at 16, and a stroke heavy enough to survive 16px looks
 * clumsy large.
 *
 *   display  >=64px   hairline outline, nine facets, small spindle
 *   text     24-64    working weight, five facets — the default
 *   micro    <24px    solid stone, facets knocked out, large spindle
 *
 * `size` picks the cut, so call sites never have to know the rule. Pass `cut`
 * only to override it on purpose.
 *
 * ── Knockouts are masks ──────────────────────────────────────────────────
 *
 * The micro cut's facets and spindle are cut out with a <mask>, not painted in
 * the background colour. A mark that fills its own holes with `#050806` looks
 * identical here and carries a dark square onto a sticker, a photo or a light
 * page. This one is genuinely transparent, so it works in one colour anywhere.
 *
 * Colour is `currentColor` throughout — set it with `text-accent`,
 * `text-ink-950` or anything else — so there is never a variant per ground.
 */

import { useId } from "react";
import {
  cutForSize as pickCut,
  CENTRE_X,
  CULET_Y,
  GIRDLE_Y,
  LOCKUP_RATIO as RATIO,
  STONE,
  TABLE_Y,
  type MarkCut,
} from "@/client/markCuts";

export type { MarkCut } from "@/client/markCuts";
export {
  cutForSize,
  LOCKUP_RATIO,
  MICRO_MAX,
  DISPLAY_MIN,
} from "@/client/markCuts";

export interface MarkProps {
  /** Rendered size in px. Also picks the cut unless `cut` is given. */
  size?: number;
  cut?: MarkCut;
  /**
   * Accessible name. Omit for a mark sitting beside the word "Gemtopia" —
   * a logo next to its own wordmark is decoration, and naming it twice is
   * noise in a screen reader.
   */
  title?: string;
  className?: string;
}

export function Mark({ size = 32, cut, title, className }: MarkProps) {
  const chosen = cut ?? pickCut(size);
  const maskId = useId();
  const labelled = Boolean(title);

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {chosen === "micro" ? (
        <MicroCut maskId={maskId} />
      ) : chosen === "display" ? (
        <DisplayCut />
      ) : (
        <TextCut />
      )}
    </svg>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Display, 64px and up.
 *
 * Nine facets rather than five: four extra lines run from the girdle's
 * extremes to the table corners and down to the culet, which is what a real
 * brilliant looks like and what there is finally room to show. Hairline at
 * 1.1, which would vanish at any working size and is the whole point at this
 * one.
 */
function DisplayCut() {
  return (
    <>
      <polygon
        points={STONE}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinejoin="round"
      />
      <g stroke="currentColor" fill="none" strokeWidth={1.1}>
        <line x1={6} y1={GIRDLE_Y} x2={58} y2={GIRDLE_Y} />
        <line x1={23} y1={TABLE_Y} x2={27} y2={GIRDLE_Y} />
        <line x1={41} y1={TABLE_Y} x2={37} y2={GIRDLE_Y} />
        <line x1={27} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
        <line x1={37} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
        <line x1={14.5} y1={GIRDLE_Y} x2={23} y2={TABLE_Y} />
        <line x1={49.5} y1={GIRDLE_Y} x2={41} y2={TABLE_Y} />
        <line x1={14.5} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
        <line x1={49.5} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
      </g>
      <circle cx={CENTRE_X} cy={GIRDLE_Y} r={3} fill="currentColor" />
    </>
  );
}

/**
 * Text, 24 to 64px. The default, and the drawing most people will know.
 *
 * Five facets at 1.6 against a 3.0 outline. The ratio is deliberate: interior
 * detail has to read as interior rather than as part of the edge, and about
 * half the outline weight is where that separation holds without the lines
 * going away.
 */
function TextCut() {
  return (
    <>
      <polygon
        points={STONE}
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <g stroke="currentColor" fill="none" strokeWidth={1.6}>
        <line x1={6} y1={GIRDLE_Y} x2={58} y2={GIRDLE_Y} />
        <line x1={23} y1={TABLE_Y} x2={27} y2={GIRDLE_Y} />
        <line x1={41} y1={TABLE_Y} x2={37} y2={GIRDLE_Y} />
        <line x1={27} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
        <line x1={37} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
      </g>
      <circle cx={CENTRE_X} cy={GIRDLE_Y} r={3.4} fill="currentColor" />
    </>
  );
}

/**
 * Micro, under 24px. Favicon, browser tab, anywhere a hairline dies.
 *
 * Inverted on purpose. Every outline version thins until the stone is a faint
 * wireframe; a filled stone with the facets knocked out has mass, and mass is
 * what survives. The spindle grows to 4.6 because a 3px hole at 16px rendered
 * size is under one device pixel and simply closes up.
 *
 * A different drawing and the same mark: same silhouette, same girdle, same
 * facets, opposite polarity.
 */
function MicroCut({ maskId }: { maskId: string }) {
  return (
    <>
      <mask id={maskId}>
        <polygon points={STONE} fill="#fff" />
        <g stroke="#000" fill="none" strokeWidth={2.6}>
          <line x1={6} y1={GIRDLE_Y} x2={58} y2={GIRDLE_Y} />
          <line x1={23} y1={TABLE_Y} x2={27} y2={GIRDLE_Y} />
          <line x1={41} y1={TABLE_Y} x2={37} y2={GIRDLE_Y} />
          <line x1={27} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
          <line x1={37} y1={GIRDLE_Y} x2={CENTRE_X} y2={CULET_Y} />
        </g>
        <circle cx={CENTRE_X} cy={GIRDLE_Y} r={4.6} fill="#000" />
      </mask>
      <rect width={64} height={64} fill="currentColor" mask={`url(#${maskId})`} />
    </>
  );
}

/* ---------------------------------------------------------------------- */

/**
 * Mark plus wordmark.
 *
 * The 0.88 is the reason this exists as a component rather than as two tags at
 * each call site. A deep brilliant is taller than it is wide, so setting it to
 * the wordmark's own size makes it loom; at 88% it sits on the same optical
 * line as the cap height. Guessing that by eye per screen is how a logo ends
 * up subtly different everywhere.
 */
export function Lockup({
  size = 22,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <Mark size={Math.round(size * RATIO)} className="text-accent" />
      <span
        className="font-semibold tracking-tight text-neutral-100"
        style={{ fontSize: size }}
      >
        Gemtopia
      </span>
    </span>
  );
}
