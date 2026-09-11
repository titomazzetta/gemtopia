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
