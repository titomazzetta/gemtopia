/**
 * The two notices Discogs' API Terms of Use ask an application to show
 * (the section headed "Discogs Intellectual Property"; read 2026-11-20, in the
 * version last updated 2025-05-27).
 *
 * The wording is theirs, so it is written down once and nowhere else:
 *
 *   - the first "prominently on Your application and any other public-facing
 *     use" (their terms allow it to sit in usage documentation). It is two
 *     sentences, and the one about the trademark is part of it;
 *   - the second "directly next to any data You use from the Discogs API",
 *     with a hyperlink to the discogs.com page that includes the data — a
 *     link that passes search-engine credit, so never a nofollow one.
 *
 * `scripts/test-discogs-notices.mjs` pins the strings, where they appear, and
 * that no link carrying the second one is marked nofollow.
 *
 * Free of `server-only` and of React: the sign-in page, the share page and
 * client components all read the same two lines.
 */
export const DISCOGS_AFFILIATION_NOTICE =
  "This application uses Discogs’ API but is not affiliated with, sponsored or endorsed by Discogs. ‘Discogs’ is a trademark of Zink Media, LLC.";

export const DISCOGS_DATA_NOTICE = "Data provided by Discogs.";
