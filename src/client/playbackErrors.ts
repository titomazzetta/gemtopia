/**
 * What the YouTube player's error code actually means.
 *
 * The handler this replaces took no argument at all — it threw the code away
 * and assumed every failure was "removed, private, or embedding disabled",
 * then skipped the track. That assumption is wrong for one of the five codes,
 * and it is the one Safari throws.
 *
 * The distinction that matters is **whose fact it is**:
 *
 *   - 100, 101, 150 are facts about the *video*. It will not play here, or in
 *     any other browser, ever. Skipping is the right answer.
 *   - 5 is a fact about the *browser session*. The HTML5 player failed — and
 *     the identical clip plays in Chrome. Skipping a clip for this is how a
 *     crate full of perfectly good records gets marked unplayable one at a
 *     time, on one browser, while the user watches it rattle through the
 *     queue wondering what they broke.
 *
 * So `permanent` drives the skip, and the code goes in the message, because
 * "a YouTube playback error" is not something anyone can act on or report.
 */
export interface PlaybackFailure {
  /** Shown to the user. Names the code so a bug report can carry it. */
  message: string;
  /** True when the clip itself is unplayable and the queue should move on. */
  permanent: boolean;
}

export function describePlaybackError(code: unknown): PlaybackFailure {
  switch (code) {
    case 2:
      return {
        message: "YouTube rejected that video id (error 2) — skipping.",
        permanent: true,
      };

    case 153:
    case 154:
      /*
       * YouTube could not identify the embedding site, because it received no
       * usable Referer header. Undocumented codes, and for a while this app
       * caused them itself with `Referrer-Policy: no-referrer` — see
       * next.config.ts. Kept as non-permanent: the clip is fine, and skipping
       * it would walk the crate marking good records bad.
       */
      return {
        message:
          "YouTube wouldn't authorise the embed (error " +
          `${code}). The clip is fine — this is a configuration problem, ` +
          "not the record.",
        permanent: false,
      };

    case 5:
      return {
        message:
          "Safari's video player couldn't start this clip (error 5). " +
          "It usually plays on a retry, and normally works in Chrome.",
        permanent: false,
      };

    case 100:
      return {
        message: "That video has been removed or made private (error 100) — skipping.",
        permanent: true,
      };

    case 101:
    case 150:
      return {
        message:
          "The uploader doesn't allow this one to play outside YouTube " +
          "(error 101) — skipping.",
        permanent: true,
      };

    default:
      /*
       * An unrecognised code is treated as transient on purpose. Skipping is
       * the destructive option — it removes a record from the set you are
       * building — and guessing "permanent" for a code nobody has seen yet is
       * how a future YouTube change quietly eats somebody's crate.
       */
      return {
        message: `YouTube playback error${
          typeof code === "number" ? ` (error ${code})` : ""
        }. Try again, or skip to the next clip.`,
        permanent: false,
      };
  }
}
