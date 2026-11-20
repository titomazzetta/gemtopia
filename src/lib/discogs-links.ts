/**
 * Canonical Discogs URLs.
 *
 * These two patterns were inlined in four separate places — `dig.ts`,
 * `recommend.ts`, the shared playlist page, and now the share button. Four
 * copies of a URL shape is three too many: the day Discogs changes a path,
 * you want one line to edit, not a grep that might miss one.
 *
 * Deliberately free of `server-only`. The share button is a client component
 * and needs the same URL the server builds, which is the whole point of
 * having one definition.
 */

const BASE = "https://www.discogs.com";

/** Discogs' front door, for a credit that has no single page to point at. */
export const DISCOGS_HOME = `${BASE}/`;

/**
 * Someone's collection on Discogs — the page the records in their crate come
 * from. A username is already a short, plain string by the time it reaches
 * here; it is encoded anyway, because this builds a link.
 */
export function collectionUrl(username: string): string {
  return `${BASE}/user/${encodeURIComponent(username)}/collection`;
}

/** Someone's wantlist on Discogs. */
export function wantlistUrl(username: string): string {
  return `${BASE}/wantlist?${new URLSearchParams({ user: username })}`;
}

/**
 * Discogs' own search for the same words — the page a list of search results
 * came from, as near as a link can say it. URLSearchParams does the encoding,
 * so nothing typed into a search box can add a parameter of its own.
 */
export function searchUrl(words: string): string {
  return `${BASE}/search/?${new URLSearchParams({ q: words.trim(), type: "release" })}`;
}

/**
 * A release id is only usable in a URL if it is a positive integer. Discogs
 * ids always are, but a `Playable` can be reconstructed from stored playlist
 * rows, and a corrupted one should produce a hidden button rather than a link
 * to `/release/NaN`.
 */
export function isReleaseId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** The public release page — what you send someone to show them a record. */
export function releaseUrl(releaseId: number): string {
  return `${BASE}/release/${releaseId}`;
}

/** Marketplace listings for that release. */
export function marketplaceUrl(releaseId: number): string {
  return `${BASE}/sell/release/${releaseId}`;
}
