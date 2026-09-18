/**
 * Noticing that a clip never started.
 *
 * `playbackErrors.ts` handles the failures YouTube *reports*. This handles
 * the one it does not: an unavailable video where the iframe draws its own
 * "This video is unavailable / Watch on YouTube" card and never fires the API
 * error event at all. Reported from a phone, on four tracks from one EP —
 * which is the shape this failure always takes, because Discogs' videos for a
 * release usually come from a single uploader, so when that upload dies the
 * whole record dies with it and the next one is fine.
 *
 * Before this, the app had no way to know. `onStateChange` handled ENDED,
 * PLAYING, PAUSED and BUFFERING and ignored UNSTARTED and CUED, and nothing
 * timed out — so a silent refusal left the player sitting at 0:00 forever,
 * with the transport showing a track that was never going to play.
 *
 * The rule is deliberately about *time*, not about reasons. Anything that
 * stops a clip starting — a dead upload, a region block, an autoplay policy,
 * a network that went away — produces the same symptom and deserves the same
 * response: say so, and move on.
 */

/** YouTube's player states, named. -1 and 5 are the two that were ignored. */
export const PLAYER_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/**
 * How long a clip gets to start before we call it stuck.
 *
 * Eight seconds is chosen against the two ways of being wrong. Too short and
 * a slow connection in a basement record shop looks like a dead video; too
 * long and you stand there watching a track that is never going to play,
 * which is the exact complaint this fixes. Buffering extends the window, so
 * this is a budget for *silence*, not for loading.
 */
export const START_TIMEOUT_MS = 8_000;

export type WatchdogAction =
  /** It started. Stop watching. */
  | "clear"
  /** Still trying — give it another full window rather than killing a slow load. */
  | "extend"
  /** No news. Let the deadline stand. */
  | "keep";

/**
 * What a player state means for a clip we asked to play.
 *
 * PAUSED counts as started on purpose: the video loaded and something paused
 * it, which may be the user or may be an autoplay policy — either way it is
 * present and playable, and skipping it would throw away a clip that works.
 */
export function watchdogAction(playerState: number): WatchdogAction {
  switch (playerState) {
    case PLAYER_STATE.PLAYING:
    case PLAYER_STATE.PAUSED:
    case PLAYER_STATE.ENDED:
      return "clear";
    case PLAYER_STATE.BUFFERING:
      return "extend";
    default:
      // UNSTARTED and CUED, and anything YouTube adds later. Waiting is not
      // progress, so the deadline keeps running.
      return "keep";
  }
}

/**
 * What to tell someone whose clip never started.
 *
 * Names the record rather than the error, because there is no error to name —
 * that is the whole point of this path. And it says "on YouTube", because the
 * record is fine and the pressing is fine; it is the upload Discogs points at
 * that has gone.
 */
export function describeStall(title: string): string {
  const name = title.trim() || "That clip";
  return `${name} wouldn't start — the YouTube upload looks unavailable. Skipping.`;
}
