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
 * Why a clip did not start.
 *
 * The comment above says the rule is about time, not reasons, and that is
 * still true of *when* we give up. It turned out to be badly wrong about what
 * to say afterwards, and about whether to skip.
 *
 * A browser that refuses to let the player start produces exactly the same
 * silence as a dead upload — and the app shipped for a while with
 * `Permissions-Policy: autoplay=(self)`, which refused every clip in the
 * collection. On that build this watchdog would have blamed each record in
 * turn and skipped it, walking the entire crate marking good pressings dead,
 * at one record per eight seconds, while the actual cause sat in a response
 * header. Precisely the failure the error-code work was meant to prevent.
 *
 * So the watchdog now asks the browser one question before it opens its
 * mouth. The answer is cheap and local — a Permissions Policy check against
 * the player's origin — and it separates "this upload is gone" from "this
 * browser will not let us press play", which are the same silence and
 * opposite instructions.
 */
export type StallVerdict = "unavailable" | "blocked";

export function stallVerdict(autoplayAllowed: boolean): StallVerdict {
  return autoplayAllowed ? "unavailable" : "blocked";
}

/**
 * Whether a stall is the record's fault, and so whether to move on.
 *
 * Only "unavailable" advances. Skipping a policy block would skip everything,
 * since the next clip is blocked for exactly the same reason.
 */
export function shouldSkipOnStall(verdict: StallVerdict): boolean {
  return verdict === "unavailable";
}

/**
 * What to tell someone whose clip never started.
 *
 * The unavailable case names the record rather than an error, because there is
 * no error to name — that is the whole point of this path — and it says
 * "on YouTube", because the record is fine and the pressing is fine; it is the
 * upload Discogs points at that has gone.
 *
 * The blocked case names the workaround instead, because there is one and it
 * works: a single press on the player's own play button gives that frame a
 * user gesture, and every control on the page starts working from then on.
 * That is not a guess — it is how this bug was found, by someone doing it.
 */
export function describeStall(title: string, autoplayAllowed = true): string {
  const name = title.trim() || "That clip";

  if (!autoplayAllowed) {
    return `${name} is ready, but this browser won't let the player start on its own. Press play on the video once and the controls will work from then on.`;
  }

  return `${name} wouldn't start — the YouTube upload looks unavailable. Skipping.`;
}

/* -- the explicit-play path ----------------------------------------------- */

/**
 * How long an explicit press of play gets before we admit it did nothing.
 *
 * Far shorter than START_TIMEOUT_MS, and for a different question. That one
 * asks "is this clip ever going to load", over a network. This one asks "did
 * the press register at all", which is local and immediate: the frame either
 * accepts the instruction or refuses it. A second is long enough to cover a
 * cued clip waking up and short enough that a dead button does not stay dead
 * and unexplained while someone taps it again.
 */
export const PLAY_CONFIRM_MS = 1_200;

export type PlayOutcome =
  /** The press took. */
  | "started"
  /** The player is exactly where it was: the instruction was refused. */
  | "blocked";

/**
 * Did an explicit press of play actually do anything?
 *
 * PAUSED counts as started here, unlike in `watchdogAction` — and the
 * difference is deliberate. This runs a second after a press, so PAUSED means
 * the clip is loaded and something paused it, most likely the person changing
 * their mind. UNSTARTED and CUED are the signature of a refusal: the clip is
 * sitting exactly where it was before the press.
 */
export function playOutcome(playerState: number): PlayOutcome {
  switch (playerState) {
    case PLAYER_STATE.UNSTARTED:
    case PLAYER_STATE.CUED:
      return "blocked";
    default:
      return "started";
  }
}

/**
 * What to say when the play button did nothing.
 *
 * Deliberately not an error about the record. Nothing is wrong with the
 * record; the browser declined to start audio, and the person needs the one
 * action that fixes it rather than a diagnosis they cannot act on.
 */
export function describeBlockedPlay(): string {
  return "This browser blocked playback from starting on its own. Press play on the video once — after that, the controls here work normally.";
}
