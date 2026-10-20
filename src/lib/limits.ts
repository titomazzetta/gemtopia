/**
 * Sizes shared by the browser and the server, so the browser can say
 * "that didn't fit" before the server has to refuse it.
 */

/** The most tracks one playlist holds (validation.ts enforces it on every write). */
export const PLAYLIST_MAX_TRACKS = 1000;
