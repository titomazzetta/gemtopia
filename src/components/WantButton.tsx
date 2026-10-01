"use client";

import { Heart } from "./Icons";

/**
 * The wantlist heart for whatever is playing.
 *
 * CrateApp decides whether there is one (`wantlistHeart` in ownership.ts —
 * anything you are not known to own) and owns the request; this only draws
 * it. One component for the three places it appears, so the desktop player,
 * the phone bar and the phone player sheet can never disagree about what a
 * filled heart means.
 */
export interface WantHeart {
  wanted: boolean;
  /** A request is in flight; the button ignores taps until it lands. */
  busy: boolean;
  onToggle: () => void;
}

export function WantButton({
  want,
  variant,
}: {
  want: WantHeart;
  /** `icon` for the phone bar, `chip` beside the desktop title, `wide` in the phone sheet. */
  variant: "icon" | "chip" | "wide";
}) {
  const label = want.wanted ? "Remove from your Discogs wantlist" : "Add to your Discogs wantlist";

  if (variant === "wide") {
    return (
      <button
        type="button"
        onClick={want.onToggle}
        disabled={want.busy}
        aria-pressed={want.wanted}
        className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium disabled:opacity-50 ${
          want.wanted
            ? "border-accent/60 bg-accent/15 text-accent"
            : "border-ink-700 text-neutral-200"
        }`}
      >
        <Heart className="h-3.5 w-3.5" filled={want.wanted} />
        {want.wanted ? "On your wantlist" : "Add to wantlist"}
      </button>
    );
  }

  if (variant === "chip") {
    return (
      <button
        type="button"
        onClick={want.onToggle}
        disabled={want.busy}
        aria-pressed={want.wanted}
        aria-label={label}
        title={`${label} (W)`}
        className={`-mt-0.5 shrink-0 rounded-md border p-1.5 transition-colors disabled:opacity-50 ${
          want.wanted
            ? "border-accent/60 bg-accent/15 text-accent"
            : "border-ink-700 text-neutral-400 hover:border-ink-600 hover:text-neutral-100"
        }`}
      >
        <Heart className="h-3.5 w-3.5" filled={want.wanted} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={want.onToggle}
      disabled={want.busy}
      aria-pressed={want.wanted}
      aria-label={label}
      className={`rounded-full p-1.5 active:bg-ink-800 disabled:opacity-50 ${
        want.wanted ? "text-accent" : "text-neutral-400"
      }`}
    >
      <Heart className="h-4 w-4" filled={want.wanted} />
    </button>
  );
}
