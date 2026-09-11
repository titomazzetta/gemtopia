import { isReleaseId, releaseUrl } from "@/lib/discogs-links";

/**
 * Sharing a record you just found.
 *
 * The unit being shared is the **Discogs release page**, not a Gemtopia link.
 * That is deliberate: the person receiving it is usually a DJ friend who does
 * not have an account here, and a link they cannot open is worse than no link.
 * The Discogs page also carries the tracklist, the pressing details and the
 * marketplace — everything they would ask for next.
 */

export interface SharePayload {
  /** Shown as the sheet's heading on platforms that display one. */
  title: string;
  /** Body text. Some targets (SMS, WhatsApp) use this and ignore `title`. */
  text: string;
  url: string;
}

export interface ShareableTrack {
  releaseId: number;
  title: string;
  artist: string;
}

/**
 * Build the payload, or `null` when the track cannot be linked.
 *
 * Returning null rather than throwing lets the button simply not render. A
 * share control that produces a broken Discogs link is worse than no control,
 * because the person only finds out after they have sent it to someone.
 */
export function buildShare(track: ShareableTrack): SharePayload | null {
  if (!isReleaseId(track.releaseId)) return null;

  const artist = track.artist.trim();
  const title = track.title.trim();
  if (!artist && !title) return null;

  const label = artist && title ? `${artist} — ${title}` : artist || title;

  return {
    title: label,
    /*
     * The URL is repeated in `text` on purpose. Targets vary in which fields
     * they honour — several messaging apps drop `url` entirely and send only
     * `text` — so a payload whose text omits the link can arrive as a bare
     * record name with no way to find it.
     */
    text: `${label}\n${releaseUrl(track.releaseId)}`,
    url: releaseUrl(track.releaseId),
  };
}

export type ShareOutcome =
  /** The OS share sheet accepted it. */
  | "shared"
  /** No share sheet, so the URL went to the clipboard instead. */
  | "copied"
  /** The user opened the sheet and backed out. Not an error. */
  | "dismissed"
  /** Neither route exists — an old browser, or a non-secure context. */
  | "unavailable";

/** The slice of `navigator` this needs, so tests can supply a fake. */
export interface ShareCapableNavigator {
  share?: (data: SharePayload) => Promise<void>;
  canShare?: (data: SharePayload) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Share if the platform can, copy if it cannot.
 *
 * Phones get the native sheet, which is the entire point — two taps to a
 * friend in Messages. Desktop browsers mostly lack `navigator.share`, so the
 * link goes to the clipboard and the button says so.
 *
 * Note `navigator.share` only resolves inside a user gesture and only on a
 * secure origin. Both hold here — it is wired to a click, and production is
 * HTTPS — but that is why this is never called on mount.
 */
export async function shareOrCopy(
  payload: SharePayload,
  nav: ShareCapableNavigator,
): Promise<ShareOutcome> {
  if (typeof nav.share === "function") {
    // `canShare` exists on some platforms that still reject the payload at
    // `share()` time, so a false here is a reason to skip, not to give up.
    const permitted = typeof nav.canShare === "function" ? nav.canShare(payload) : true;
    if (permitted) {
      try {
        await nav.share(payload);
        return "shared";
      } catch (error) {
        /*
         * AbortError means the person closed the sheet. Falling through to
         * the clipboard there would silently copy something they had just
         * decided not to send, so it is reported as its own outcome and the
         * UI stays quiet.
         */
        if (error instanceof Error && error.name === "AbortError") return "dismissed";
        // Any other failure is worth falling back for rather than surfacing.
      }
    }
  }

  if (nav.clipboard && typeof nav.clipboard.writeText === "function") {
    try {
      await nav.clipboard.writeText(payload.url);
      return "copied";
    } catch {
      return "unavailable";
    }
  }

  return "unavailable";
}
