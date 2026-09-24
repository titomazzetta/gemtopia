import type { Playable } from "@/lib/types";
import { textKey } from "./sorting";

/**
 * Looking at a playlist a different way without losing the set.
 *
 * A playlist's order is the set — the story you are telling, arranged by
 * hand. It is also, some days, not the easiest way to *find* something in it:
 * "which of these is the Moodymann", "what have I got over 128", "is this
 * whole thing from 1996". Rekordbox and iTunes answer that with column sorts,
 * and both keep a "#" column that puts the list back the way you made it.
 *
 * That is the model here, made stricter. A view is a lens, never an edit:
 *
 *   - "Your order" is always the first option and always the default. Opening
 *     a playlist lands on it; nothing you click in another view changes it.
 *   - Every other view is computed, not stored. It is a permutation of the
 *     stored rows — indices into them — so a row on screen can always be
 *     traced back to the entry it came from, even when the same clip appears
 *     twice.
 *   - Ties keep your order. Five records by one artist stay in the order you
 *     put them in, so a view never scrambles more than it has to.
 *   - Unknowns sink, in both directions, exactly as they do in the crate: a
 *     record with no BPM yet is not a slow record.
 *   - Adopting a view as the new order is a separate, explicit action, and
 *     one step of undo is kept for it. See `adoptView` and `canRestore`.
 *
 * The transition checks only mean something between records that will
 * actually be played one after the other, so they belong to "Your order" and
 * are hidden in every other view. That keeps the emotive, hand-built order as
 * the place where set prep happens, and the other views as places you visit.
 */

export type PlaylistView = "yours" | "artist" | "genre" | "bpm" | "year";
export type ViewDirection = "asc" | "desc";

export interface PlaylistViewState {
  view: PlaylistView;
  direction: ViewDirection;
}

/** Left to right, as the chips read. "Your order" first, always. */
export const PLAYLIST_VIEWS: readonly PlaylistView[] = [
  "yours",
  "artist",
  "genre",
  "bpm",
  "year",
];

export const VIEW_LABELS: Record<PlaylistView, string> = {
  yours: "Your order",
  artist: "Artist",
  genre: "Genre",
  bpm: "BPM",
  year: "Year",
};

export const YOUR_ORDER: PlaylistViewState = { view: "yours", direction: "asc" };

/**
 * Every view starts ascending: A–Z for text, slowest first for tempo (how a
 * set climbs), oldest first for year. Same reasoning as the crate columns.
 */
const NATURAL_DIRECTION: ViewDirection = "asc";

/**
 * What tapping a chip does.
 *
 * Another view: switch to it, in its natural direction. The view you are
 * already on: flip it. "Your order": always back to your order — it has no
 * direction to flip, and there is deliberately no third tap that "clears" a
 * view, because the way out is the chip that is always there.
 */
export function nextView(
  current: PlaylistViewState,
  view: PlaylistView,
): PlaylistViewState {
  if (view === "yours") return YOUR_ORDER;
  if (current.view !== view) return { view, direction: NATURAL_DIRECTION };
  return { view, direction: current.direction === "asc" ? "desc" : "asc" };
}

function numberKey(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Genre means what a DJ means by it: the Discogs *style* ("Deep House",
 * "Dub Techno"), falling back to the broad genre ("Electronic") only when a
 * release has no style. Sorting on the broad genre alone would put an entire
 * house set into one bucket called Electronic.
 */
export function genreOf(item: Playable): string | null {
  return textKey(item.styles[0]) ?? textKey(item.genres[0]);
}

function keyOf(item: Playable, view: PlaylistView): string | number | null {
  switch (view) {
    case "yours":
      return null;
    case "artist":
      return textKey(item.artist);
    case "genre":
      return genreOf(item);
    case "bpm":
      return numberKey(item.bpm);
    case "year":
      return numberKey(item.year);
  }
}

/**
 * The order to show the rows in, as indices into `items` (which must be in
 * the stored order). "Your order" is the identity. Never mutates.
 */
export function viewPermutation(
  items: readonly Playable[],
  state: PlaylistViewState,
): number[] {
  const indices = items.map((_, index) => index);
  if (state.view === "yours") return indices;

  const factor = state.direction === "asc" ? 1 : -1;
  const keys = items.map((item) => keyOf(item, state.view));

  return indices.sort((a, b) => {
    const left = keys[a] ?? null;
    const right = keys[b] ?? null;

    // Unknowns sink in both directions; among themselves, your order.
    if (left === null && right === null) return a - b;
    if (left === null) return 1;
    if (right === null) return -1;

    const comparison =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), undefined, {
            sensitivity: "base",
            numeric: true,
          });

    // Ties keep your order — in both directions, not reversed with the rest.
    return comparison !== 0 ? comparison * factor : a - b;
  });
}

/** True when `order` is exactly the indices 0..length-1, each once. */
export function isPermutation(order: readonly number[], length: number): boolean {
  if (order.length !== length) return false;
  const seen = new Uint8Array(length);
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= length) return false;
    if (seen[index]) return false;
    seen[index] = 1;
  }
  return true;
}

/**
 * The stored-row index behind a row on screen. Remove, and anything else that
 * edits the playlist, has to go through this: in a sorted view, "the third
 * row" is not the third entry.
 */
export function entryIndexAt(order: readonly number[], visibleIndex: number): number | null {
  const index = order[visibleIndex];
  return typeof index === "number" ? index : null;
}

/**
 * Make the view the new stored order. Returns null — and the caller saves
 * nothing — unless `order` is a true permutation of `entries`. That is the
 * guarantee worth having: adopting a view can reorder a set, and can never
 * drop, duplicate or invent a record.
 */
export function adoptView<T>(entries: readonly T[], order: readonly number[]): T[] | null {
  if (!isPermutation(order, entries.length)) return null;
  return order.map((index) => entries[index] as T);
}

/**
 * Whether a remembered order can be put back over the current one.
 *
 * Only when both hold exactly the same records, the same number of times —
 * i.e. restoring is a pure reorder. If you added or removed something since,
 * restoring would silently undo that too, so undo is withdrawn instead.
 */
export function canRestore(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  if (previous.length !== current.length) return false;
  const counts = new Map<string, number>();
  for (const key of previous) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of current) {
    const left = counts.get(key);
    if (!left) return false;
    counts.set(key, left - 1);
  }
  return true;
}

/** Same order, same records? Used to tell whether a view would change anything. */
export function sameOrder(order: readonly number[]): boolean {
  return order.every((index, position) => index === position);
}

const DIRECTION_WORDS: Record<Exclude<PlaylistView, "yours">, Record<ViewDirection, string>> = {
  artist: { asc: "A to Z", desc: "Z to A" },
  genre: { asc: "A to Z", desc: "Z to A" },
  bpm: { asc: "slowest first", desc: "fastest first" },
  year: { asc: "oldest first", desc: "newest first" },
};

/** How a view reads mid-sentence: "by artist", "by BPM". */
export function viewName(view: PlaylistView): string {
  return view === "bpm" ? "BPM" : VIEW_LABELS[view].toLowerCase();
}

/** The one line under the chips while a view is on. Never shown for "yours". */
export function describeView(state: PlaylistViewState): string {
  if (state.view === "yours") return "";
  return `By ${viewName(state.view)}, ${DIRECTION_WORDS[state.view][state.direction]}. Your order is saved.`;
}

/** What each chip's arrow says, for the view that is on. */
export function directionArrow(state: PlaylistViewState): string {
  if (state.view === "yours") return "";
  return state.direction === "asc" ? "↑" : "↓";
}
