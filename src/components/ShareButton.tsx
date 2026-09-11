"use client";

import { useEffect, useState } from "react";
import { buildShare, shareOrCopy, type ShareOutcome, type ShareableTrack } from "@/client/share";
import { Share } from "./Icons";

/** How long the "Copied" confirmation stays up. */
const FEEDBACK_MS = 1600;

/**
 * Share the Discogs page for a record.
 *
 * On a phone this opens the native share sheet — two taps to send a record to
 * someone in Messages, which is what actually happens when you turn something
 * up mid-shuffle. On desktop, where `navigator.share` mostly does not exist,
 * it copies the link and says so.
 *
 * The button renders nothing when the track has no usable release id, rather
 * than offering a control that produces a dead link.
 */
export function ShareButton({
  track,
  variant = "icon",
  className = "",
}: {
  track: ShareableTrack | null;
  /** `icon` for list rows, `wide` for the player sidebar. */
  variant?: "icon" | "wide";
  className?: string;
}) {
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);

  // Clear the confirmation after a beat. Keyed on `outcome` so each share
  // restarts the timer rather than inheriting the previous one's remainder.
  useEffect(() => {
    if (outcome === null) return;
    const timer = setTimeout(() => setOutcome(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const payload = track ? buildShare(track) : null;
  if (!payload) return null;

  const onClick = async (event: React.MouseEvent) => {
    /*
     * In a list row the whole row is a play button. Without this, sharing a
     * record would also start playing it — which is exactly the wrong moment
     * to change what is coming out of the speakers.
     */
    event.stopPropagation();
    setOutcome(await shareOrCopy(payload, navigator));
  };

  // "dismissed" says the person backed out of the sheet on purpose; saying
  // anything about that would be noise.
  const said =
    outcome === "copied"
      ? "Link copied"
      : outcome === "unavailable"
        ? "Couldn't copy"
        : null;

  if (variant === "wide") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center justify-center gap-1.5 rounded-md border border-ink-700 bg-ink-850 py-2 text-xs font-medium text-neutral-300 hover:border-ink-600 hover:text-white ${className}`}
      >
        <Share className="h-3.5 w-3.5" />
        {said ?? "Share this record"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={said ?? `Share ${payload.title} on Discogs`}
      aria-label={`Share ${payload.title} on Discogs`}
      /*
       * Visible by default, hover-revealed only from `lg` up. The original row
       * actions were `opacity-0` until `group-hover`, which on a touch screen
       * means permanently invisible — you can only find them by tapping where
       * you guess they are. Sharing is the one action most likely to happen on
       * a phone, so it cannot be the one hidden there.
       */
      className={`shrink-0 rounded p-1.5 transition-opacity hover:bg-ink-800 hover:text-accent focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100 ${
        said ? "text-accent" : "text-neutral-600"
      } ${className}`}
    >
      <Share className="h-3.5 w-3.5" />
    </button>
  );
}
