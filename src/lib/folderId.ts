/**
 * A Discogs folder id worth keeping: a positive whole number.
 *
 * Folder 0 is "All" — every record is in it, so it says nothing — and
 * anything else (missing, a string, a fraction) is "not known", which the
 * Folder filter never hides. The collection listing is the app's critical
 * path and the folder on each row is a nicety, so this is read loosely
 * rather than validated: an odd value can cost a chip, never the sync.
 */
export function folderIdOf(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}
