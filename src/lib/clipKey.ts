/**
 * The two shapes of key that name a track in a crate or a playlist.
 *
 *   `123456:dQw4w9WgXcQ`  a YouTube clip on Discogs release 123456 — the
 *                         original shape, and the only one that can play.
 *   `123456:t.B2`         a track from the release's Discogs tracklist that
 *                         has no clip: "record only". You can put it in a
 *                         set, log its BPM, and write the set list from the
 *                         records on your shelf; the player skips it.
 *
 * The `t.` prefix cannot collide with a clip: a YouTube id is exactly eleven
 * of [A-Za-z0-9_-], and never contains a dot. The same patterns are enforced
 * in Zod (validation.ts) and as CHECK constraints in Postgres (schema.sql),
 * so a key that isn't one of these two shapes can't be stored by any route.
 */

/** Either shape. Release ids are up to 12 digits; positions up to 16 chars. */
export const CLIP_KEY_PATTERN = /^[1-9]\d{0,11}:(?:[A-Za-z0-9_-]{11}|t\.[A-Za-z0-9-]{1,16})$/;

const TRACK_ONLY = /^[1-9]\d{0,11}:t\.[A-Za-z0-9-]{1,16}$/;

export function isClipKey(value: unknown): value is string {
  return typeof value === "string" && CLIP_KEY_PATTERN.test(value);
}

/** A track with no clip — named from the tracklist, not from YouTube. */
export function isTrackOnlyKey(value: unknown): boolean {
  return typeof value === "string" && TRACK_ONLY.test(value);
}

/**
 * The key for a tracklist entry with no clip.
 *
 * Built from Discogs' printed position ("A1", "B2", "1-3", "CD2-4"), reduced
 * to letters, digits and dashes — positions are free text on Discogs and can
 * carry spaces, dots or worse. A track with no usable position falls back to
 * its place in the tracklist (`n3`). `taken` holds the keys already used on
 * this release, so two tracks printed with the same position still get
 * different keys.
 */
export function trackOnlyKey(
  releaseId: number,
  position: string | null | undefined,
  index: number,
  taken: Set<string> = new Set(),
): string {
  const slug = (position ?? "").replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) || `n${index + 1}`;
  let key = `${releaseId}:t.${slug}`;
  if (taken.has(key)) key = `${releaseId}:t.${slug}-${index + 1}`.slice(0, `${releaseId}:t.`.length + 16);
  taken.add(key);
  return key;
}
