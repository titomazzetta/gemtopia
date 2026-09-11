import { isReleaseId, releaseUrl } from "@/lib/discogs-links";

/**
 * Sharing a record you just found.
 *
 * The unit being shared is the **Discogs release page**, not a Gemtopia link.
 * The person receiving it is usually a DJ friend with no account here, and a
 * link they cannot open is worse than no link. The Discogs page also carries
 * the tracklist, the pressing and the marketplace — everything they ask for
 * next anyway.
 *
 * What crosses to the share sheet is **the URL and nothing else**. The first
 * version also passed a title and a `text` that repeated the link, on the
 * reasoning that some targets discard the `url` field. Targets that honour
 * both — which is most of them — rendered it twice:
 *
 *     Halo Varga — Halo Varga – My Sound (Future)
 *     https://www.discogs.com/release/132
 *     https://www.discogs.com/release/132
 *
 * A bare URL is also the better artefact. Messages, WhatsApp and Slack all
 * unfurl a Discogs link into a preview carrying the sleeve and the title,
 * which beats any text this could have prepended.
 */

export interface SharePayload {
  /**
   * Display text for the button's tooltip and accessible name. Deliberately
   * *not* part of what gets shared.
   */
  label: string;
  url: string;
}

export interface ShareableTrack {
  releaseId: number;
  title: string;
  artist: string;
}

const normalise = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * "Artist — Title", unless the title already opens with the artist.
 *
 * Discogs attaches videos at the release level, and their titles are whatever
 * the person who uploaded them typed — very often "Artist – Track", already
 * carrying the artist. Prefixing unconditionally produced "Halo Varga — Halo
 * Varga – My Sound (Future)". Compared on alphanumerics only, because the
 * separator in an uploaded title is an en dash about as often as a hyphen,
 * and casing is not to be trusted either.
 */
export function displayLabel(artist: string, title: string): string {
  const a = artist.trim();
  const t = title.trim();
  if (!a) return t;
  if (!t) return a;
  if (normalise(t).startsWith(normalise(a))) return t;
  return `${a} — ${t}`;
}

/**
 * Build the payload, or `null` when the track cannot be linked.
 *
 * Null rather than a throw lets the button simply not render. A share control
 * that produces a broken Discogs link is worse than no control, because the
 * sender only finds out after someone else has opened it.
 */
export function buildShare(track: ShareableTrack): SharePayload | null {
  if (!isReleaseId(track.releaseId)) return null;

  const label = displayLabel(track.artist, track.title);
  if (!label) return null;

  return { label, url: releaseUrl(track.releaseId) };
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

/** What actually crosses to the platform: a URL, nothing more. */
export interface SharedData {
  url: string;
}

/** The slice of `navigator` this needs, so tests can supply a fake. */
export interface ShareCapableNavigator {
  share?: (data: SharedData) => Promise<void>;
  canShare?: (data: SharedData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Share if the platform can, copy if it cannot.
 *
 * Phones get the native sheet, which is the entire point — two taps to a
 * friend in Messages. Desktop browsers mostly lack `navigator.share`, so the
 * link goes to the clipboard and the button says so.
 *
 * `navigator.share` only resolves inside a user gesture and only on a secure
 * origin. Both hold here — it is wired to a click, and production is HTTPS —
 * which is why this is never called on mount.
 */
export async function shareOrCopy(
  payload: SharePayload,
  nav: ShareCapableNavigator,
): Promise<ShareOutcome> {
  const data: SharedData = { url: payload.url };

  if (typeof nav.share === "function") {
    // `canShare` exists on platforms that still reject the payload at
    // `share()` time, so a false here is a reason to skip, not to give up.
    const permitted = typeof nav.canShare === "function" ? nav.canShare(data) : true;
    if (permitted) {
      try {
        await nav.share(data);
        return "shared";
      } catch (error) {
        /*
         * AbortError means the person closed the sheet. Falling through to
         * the clipboard there would silently copy something they had just
         * decided not to send, so it is its own outcome and the UI stays
         * quiet.
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
