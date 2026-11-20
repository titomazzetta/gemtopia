/**
 * What a share link looks like when it is pasted into a chat.
 *
 * Messages, WhatsApp, Slack and the rest fetch a pasted link and build a card
 * from its Open Graph tags. Without them a set arrived as a grey box reading
 * "A set on Gemtopia" and a domain — the one page here meant for other people,
 * introduced as nothing in particular.
 *
 * A card is also a copy nobody can take back. It is made once, by the chat it
 * was pasted into, and it stays in that conversation after the owner revokes
 * the link. So what goes on it is a decision, and this is it:
 *
 *   - the set's **name**, and **how many tracks** it has;
 *   - never a track, an artist, a record, or anything about who made it.
 *
 * The name is what the person sharing just typed or chose to send, to the
 * people they chose to send it to. The running order is the thing the link
 * protects, and it dies with the link.
 *
 * Three rules keep the card from becoming a way in:
 *
 *   - **The address comes from configuration, never from the request.** The
 *     `Host` header is whatever the caller says it is; a card that echoed it
 *     would let anyone mint a Gemtopia-looking card that points at their own
 *     site. `origin` here is `APP_ORIGIN`, the same value the OAuth callback
 *     is built from.
 *   - **A token that isn't token-shaped gets no address at all.** It cannot
 *     match a set, so there is nothing to point at.
 *   - **The name is cleaned for where it is going.** A playlist name is free
 *     text. On the page it is a heading; in somebody's chat it sits beside
 *     their own words, where a direction override or a run of invisible
 *     characters could make it read as something else.
 *
 * Pure, and free of `server-only`, so a test can import it.
 */

/** 32 random bytes, base64url: the only shape a share token has. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The picture every card carries. One static file: no set's artwork, no per-request image. */
export const CARD_IMAGE = {
  path: "/og-set.png",
  width: 1200,
  height: 630,
  alt: "Gemtopia",
} as const;

export const CARD_SITE = "Gemtopia";
const GENERIC_TITLE = "A set on Gemtopia";
const GENERIC_DESCRIPTION = "A set of records to play straight through, shared from Gemtopia.";

/** Long enough for any real name (the app caps them at 80), short enough for a card. */
const TITLE_MAX = 80;

export interface ShareCard {
  /** The browser tab. */
  pageTitle: string;
  /** og:title — the set's name, or the generic line. */
  title: string;
  /** og:site_name. */
  siteName: string;
  /** og:description and the meta description. */
  description: string;
  /** og:url — absent when there is no real set to point at. */
  url: string | null;
  /** og:image, absolute. */
  image: string;
}

/**
 * Text fit to sit in someone else's chat: no control, format or private-use
 * characters (that covers direction overrides, zero-width joins and soft
 * hyphens), no lone surrogates, whitespace of any kind collapsed to single
 * spaces, and an ellipsis where it had to be cut.
 */
export function cardText(value: string, max: number): string {
  let kept = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    // A lone surrogate half: `for…of` hands these over one at a time.
    if (code >= 0xd800 && code <= 0xdfff) continue;
    if (/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u.test(char)) {
      // A line break or tab still separated two words.
      kept += /\s/u.test(char) ? " " : "";
      continue;
    }
    kept += char;
  }
  const flat = kept.replace(/\s+/gu, " ").trim();
  const chars = [...flat];
  if (chars.length <= max) return flat;
  return `${chars.slice(0, Math.max(1, max - 1)).join("").trimEnd()}…`;
}

const trackCount = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "track" : "tracks"}`;

/**
 * The card for a share link.
 *
 * `set` is null when the token matched nothing — unknown, malformed and
 * revoked all look the same here, as they do on the page — and the card is
 * then the generic one, with no address.
 */
export function shareCard(input: {
  origin: string;
  token: string;
  set: { name: string; tracks: number } | null;
}): ShareCard {
  const image = `${input.origin}${CARD_IMAGE.path}`;
  const name = input.set ? cardText(input.set.name, TITLE_MAX) : "";
  if (!input.set || name === "" || !TOKEN.test(input.token)) {
    return {
      pageTitle: GENERIC_TITLE,
      title: GENERIC_TITLE,
      siteName: CARD_SITE,
      description: GENERIC_DESCRIPTION,
      url: null,
      image,
    };
  }
  const tracks = Number.isFinite(input.set.tracks) && input.set.tracks >= 0 ? Math.floor(input.set.tracks) : 0;
  return {
    pageTitle: `${name} · a set on Gemtopia`,
    title: name,
    siteName: CARD_SITE,
    description: `${trackCount(tracks)}, in the order they were meant to be played. Shared from Gemtopia.`,
    url: `${input.origin}/s/${input.token}`,
    image,
  };
}
