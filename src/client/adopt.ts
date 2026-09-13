import type { ReleaseDetail, ReleaseSummary } from "@/lib/types";

/**
 * Taking a record you just added and putting it in the crate, now.
 *
 * The alternative was to let the next sync find it. That sync walks the whole
 * collection and can take ten minutes on a large one, which is fine for a
 * background top-up and useless for the moment this feature exists to serve:
 * the record arrived in the post, you are stood at the decks, you add it, and
 * you want to hear it. A ten-minute wait turns "add it" into "add it and come
 * back later", which is the behaviour people already had on discogs.com.
 *
 * So the add path fetches that one release and folds it into the same two
 * places a sync would have written it — no special case downstream, no second
 * code path for "recently added" records. The crate cannot tell the
 * difference, which is the point.
 */

/**
 * Project a detail down to the summary the index stores.
 *
 * `ReleaseDetail extends ReleaseSummary`, so spreading a detail into the
 * summary store would compile, work, and quietly put a full tracklist, every
 * video, the release notes and the marketplace snapshot into a store whose
 * whole job is to stay small enough to hold a 5,000-record collection in a
 * phone's IndexedDB. This lists the fields instead, so adding a field to
 * `ReleaseDetail` can never silently enlarge every summary row.
 */
export function summaryOf(
  detail: ReleaseDetail,
  /**
   * When the record entered the collection.
   *
   * Discogs' release endpoint cannot answer this — it describes a pressing,
   * not your copy of one — so a detail fetched that way always carries
   * `addedAt: null`. A sync reads the real value from the collection endpoint.
   * The add path is the one case where the app knows the answer first-hand,
   * because it is the thing that just did it, so it says so instead of
   * storing a null and waiting for a sync to fill it in.
   */
  addedAt: string | null = detail.addedAt,
): ReleaseSummary {
  return {
    id: detail.id,
    title: detail.title,
    artist: detail.artist,
    year: detail.year,
    genres: detail.genres,
    styles: detail.styles,
    labels: detail.labels,
    formats: detail.formats,
    country: detail.country,
    artistIds: detail.artistIds,
    labelIds: detail.labelIds,
    addedAt,
    thumb: detail.thumb,
    coverImage: detail.coverImage,
  };
}

/**
 * Fold a freshly fetched release into the cached details.
 *
 * Replaces rather than appends when the release is already known — adding a
 * record you already own is a thing that happens (a second copy, a mistake,
 * two sessions on two devices), and the crate must not grow a duplicate entry
 * for it. The newer copy wins because it was fetched just now.
 */
export function mergeDetail(
  details: readonly ReleaseDetail[],
  incoming: ReleaseDetail,
): ReleaseDetail[] {
  const index = details.findIndex((detail) => detail.id === incoming.id);
  if (index === -1) return [...details, incoming];

  const next = [...details];
  next[index] = incoming;
  return next;
}

/**
 * What to tell someone after the add landed.
 *
 * The interesting case is the silent one. A crate is built from the YouTube
 * links Discogs holds against a release, so a pressing with no links is a
 * record you now own that will never appear in the list - and "Added to your
 * collection" next to a crate that did not change is precisely the kind of
 * half-truth that makes someone press the button twice and then stop trusting
 * the app. It is on Discogs either way; say which of the two things happened.
 */
export function describeAdoption(detail: ReleaseDetail): string {
  const name = detail.title.trim() || "That record";

  if (detail.videos.length === 0) {
    return `${name} is in your collection. Discogs has no audio for this pressing, so it won't turn up in the crate.`;
  }

  return `${name} is in your collection and ready to play.`;
}

/**
 * Did fetching the detail fail in a way that leaves the add still true?
 *
 * The add and the fetch are two calls, and only the first one changes
 * anything on Discogs. If the POST succeeds and the detail fetch then fails -
 * rate limit, flaky connection, a tab closing - the record *is* in the
 * collection, and the app must not imply otherwise by reporting an error that
 * sounds like the add did not happen.
 */
export function describePartialAdoption(detail: { title: string }): string {
  const name = detail.title.trim() || "That record";
  return `${name} is in your collection. Couldn't load it into the crate just now - it'll appear on the next sync.`;
}
