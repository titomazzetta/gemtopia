/**
 * Your own words for your tracks: "deep", "opening", "closing".
 *
 * A tag is private to the account that made it, like the BPM catalogue. It is
 * stored against a track's clip key, and it never leaves through a playlist,
 * a share link, a chat note or an export file. The only way out of the
 * database is GET /api/track-tags, for the user who wrote it.
 *
 * This module is the one place a tag's form is decided, and both sides use
 * it: the browser before it sends, the server before it stores (the server's
 * word is final; the browser only saves a round trip). The database then
 * refuses anything outside that form with its own CHECKs (db/schema.sql).
 */

/** Longest tag, counted in code points — what Postgres's char_length counts. */
export const TAG_MAX_CHARS = 32;

/** Most tags one track can carry. */
export const TAGS_PER_TRACK = 12;

/**
 * Most tag rows one account can hold: 2,000 tracks with ten tags each. Far
 * past any real crate's use, and a ceiling on what one session can make the
 * database store.
 */
export const TAG_ROWS_PER_USER = 20_000;

/**
 * Offered before you've made any tags of your own: the three words the
 * feature was asked for with. Once you have tags, yours are offered instead.
 */
export const STARTER_TAGS: readonly string[] = ["deep", "opening", "closing"];

// A high surrogate not followed by a low one, or the reverse. JSON can carry
// these; Postgres can't store them.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// C0 and C1 control characters, newlines and tabs included: a tag is one line.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

/*
 * Invisible characters that change how text is drawn: the soft hyphen,
 * zero-width space, the directional marks, bidi embeddings, overrides and
 * isolates, the word joiner and invisible operators, the BOM and the
 * interlinear annotation marks. The same set as chat (lib/chat.ts), so a tag
 * can't be made to read as something it isn't. Zero-width joiner and
 * non-joiner stay: emoji sequences and some scripts need them.
 */
const INVISIBLE = /[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/g;

// More than four combining marks on one character is "Zalgo" text.
const MARK_STACK = /(\p{M}{4})\p{M}+/gu;

// A letter, a number, punctuation or a symbol (emoji are symbols).
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

export type NormalisedTag =
  | { ok: true; tag: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * The one form a tag is stored in: NFC, lower case, one space between words,
 * no control or invisible characters, no leading "#" (people type one), no
 * commas (the separator when you type several). Refused rather than cut when
 * it's empty or too long, so a tag is never silently changed into another.
 */
export function normaliseTag(input: unknown): NormalisedTag {
  if (typeof input !== "string") return { ok: false, reason: "empty" };
  // Bound the work before any regex runs over it.
  if (input.length > 400) return { ok: false, reason: "too_long" };

  const tag = input
    .replace(LONE_SURROGATE, "")
    .normalize("NFC")
    .replace(CONTROL, " ")
    .replace(INVISIBLE, "")
    .replace(MARK_STACK, "$1")
    .replace(/,/g, " ")
    .replace(/\s+/gu, " ")
    .trim()
    // "#deep", "# deep", "##deep": the hash is how people write a tag, not
    // part of it. All of them, so a second pass changes nothing.
    .replace(/^[#\s]+/u, "")
    .toLowerCase()
    .normalize("NFC");

  // Something you can see: not only joiners, marks or spaces.
  if (!VISIBLE.test(tag)) return { ok: false, reason: "empty" };
  if (Array.from(tag).length > TAG_MAX_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, tag };
}

export type NormalisedTags =
  | { ok: true; tags: string[] }
  | { ok: false; reason: "empty" | "too_long" | "too_many" };

/**
 * A track's whole set of tags, in stored form: each one normalised, repeats
 * dropped, in sorted order. One bad tag refuses the lot — a request either
 * says exactly what's stored or nothing is.
 */
export function normaliseTags(input: unknown): NormalisedTags {
  if (!Array.isArray(input)) return { ok: false, reason: "empty" };
  if (input.length > TAGS_PER_TRACK * 2) return { ok: false, reason: "too_many" };
  const seen = new Set<string>();
  for (const raw of input) {
    const one = normaliseTag(raw);
    if (!one.ok) return one;
    seen.add(one.tag);
  }
  if (seen.size > TAGS_PER_TRACK) return { ok: false, reason: "too_many" };
  return { ok: true, tags: sortTags(seen) };
}

/**
 * Code-point order: the same on every machine, which a locale's collation
 * isn't, and alphabetical for the tags people actually write.
 */
export function sortTags(tags: Iterable<string>): string[] {
  return [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Every tag in use, most-used first: the Tags filter and the suggestions. */
export function rankTags(
  byTrack: ReadonlyMap<string, readonly string[]>,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const tags of byTrack.values()) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}

/**
 * What to offer while tagging a track: your tags, most-used first, that this
 * track doesn't have yet — narrowed to what you've typed, words that start
 * with it first. Before you have any, the starter words.
 */
export function suggestTags(
  ranked: ReadonlyArray<readonly [string, number]>,
  current: readonly string[],
  typed: string,
  limit = 6,
): Array<[string, number | null]> {
  const have = new Set(current);
  const pool: Array<[string, number | null]> =
    ranked.length > 0
      ? ranked.map(([tag, count]) => [tag, count])
      : STARTER_TAGS.map((tag) => [tag, null]);
  const open = pool.filter(([tag]) => !have.has(tag));

  const needle = normaliseTag(typed);
  if (!needle.ok) return open.slice(0, limit);
  const starts: Array<[string, number | null]> = [];
  const inside: Array<[string, number | null]> = [];
  for (const entry of open) {
    const tag = entry[0];
    if (tag.split(" ").some((word) => word.startsWith(needle.tag)) || tag.startsWith(needle.tag)) {
      starts.push(entry);
    } else if (tag.includes(needle.tag)) {
      inside.push(entry);
    }
  }
  return [...starts, ...inside].slice(0, limit);
}

/** Tags as the crate's search box sees them: "#deep #opening". */
export function tagHaystack(tags: readonly string[] | undefined): string {
  return tags && tags.length > 0 ? tags.map((tag) => `#${tag}`).join(" ") : "";
}

/**
 * Each track with your tags on it where it has some; the rest unchanged, and
 * the same array when you have no tags at all.
 */
export function withTags<T extends { key: string; tags?: readonly string[] }>(
  items: T[],
  byKey: ReadonlyMap<string, readonly string[]>,
): T[] {
  if (byKey.size === 0) return items;
  return items.map((item) => {
    const tags = byKey.get(item.key);
    return tags ? { ...item, tags } : item;
  });
}
