"use client";

import type { Playable } from "@/lib/types";

/**
 * Sorting the crate.
 *
 * Shuffle is for when you don't know what you want. Sorting is for when you
 * do: everything you own between 120 and 126, oldest first; the whole of a
 * label's output in catalogue order; the tracks with no tempo yet, gathered so
 * you can measure them in one pass.
 *
 * Every comparison here has to answer the same awkward question — where do the
 * *unknowns* go? A crate mid-measurement is mostly records with no BPM, and a
 * sort that scatters them through the results, or that flips them to the top
 * when you reverse the direction, is unusable. So missing values always sink,
 * in both directions. Ascending by tempo puts 118 first and the unmeasured
 * last; descending puts 174 first and the unmeasured *still* last. That is
 * deliberately not a symmetric reversal, because "no tempo" is not a tempo and
 * pretending it sorts is what makes a list feel broken.
 */

export type SortKey =
  | "title"
  | "artist"
  | "label"
  | "year"
  | "bpm"
  | "duration"
  | "added";
export type SortDirection = "asc" | "desc";

export interface SortState {
  key: SortKey;
  direction: SortDirection;
}

export const SORT_LABELS: Record<SortKey, string> = {
  title: "Title",
  artist: "Artist",
  label: "Label",
  year: "Year",
  bpm: "BPM",
  duration: "Length",
  added: "Added",
};

/** Case- and accent-insensitive, and "The Orb" files under O, not T. */
const ARTICLE = /^(the|a|an)\s+/i;

function textKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value.replace(ARTICLE, "").trim();
  if (!stripped) return null;
  return stripped.toLocaleLowerCase();
}

function numberKey(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The comparable value for one item under one sort key. */
function keyOf(item: Playable, key: SortKey): string | number | null {
  switch (key) {
    case "title":
      return textKey(item.title);
    case "artist":
      return textKey(item.artist);
    case "label":
      return textKey(item.labels[0]);
    case "year":
      return numberKey(item.year);
    case "bpm":
      return numberKey(item.bpm);
    case "duration":
      return numberKey(item.duration);
    case "added":
      /*
       * Compared as epoch milliseconds rather than as an ISO string. String
       * comparison happens to work for well-formed UTC ISO-8601, and stops
       * working the moment Discogs returns an offset like +01:00 — which
       * sorts before "Z" lexically and after it chronologically.
       */
      return item.addedAt === null
        ? null
        : numberKey(Date.parse(item.addedAt));
  }
}

/**
 * Sort a copy. Never mutates, because the caller's array is React state.
 *
 * Ties break on title then clip key, so the order is *total*: re-sorting the
 * same list by the same key always gives the same arrangement. Without that,
 * two records with the same tempo could swap places on an unrelated re-render,
 * which reads as the list twitching.
 */
export function sortItems(items: readonly Playable[], sort: SortState): Playable[] {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...items].sort((a, b) => {
    const left = keyOf(a, sort.key);
    const right = keyOf(b, sort.key);

    // Unknowns sink, in both directions. See the note at the top.
    if (left === null && right === null) return tieBreak(a, b);
    if (left === null) return 1;
    if (right === null) return -1;

    let comparison: number;
    if (typeof left === "number" && typeof right === "number") {
      comparison = left - right;
    } else {
      comparison = String(left).localeCompare(String(right), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }

    if (comparison !== 0) return comparison * factor;
    return tieBreak(a, b);
  });
}

/** Stable, direction-independent tiebreak so sorting is deterministic. */
function tieBreak(a: Playable, b: Playable): number {
  const byTitle = (textKey(a.title) ?? "").localeCompare(textKey(b.title) ?? "");
  if (byTitle !== 0) return byTitle;
  return a.key.localeCompare(b.key);
}

/**
 * What clicking a column header does.
 *
 * First click sorts by that column in its natural direction; clicking the same
 * column again reverses it; a third click clears the sort and returns the crate
 * to its default order — newest first, which is `DEFAULT_SORT` below.
 *
 * That third state used to drop you into the order IndexedDB happened to
 * return, which is by release id: not meaningless exactly, but meaningless to
 * a person. Clearing a sort should land somewhere you would have chosen.
 */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (current?.key !== key) return { key, direction: naturalDirection(key) };
  if (current.direction === naturalDirection(key)) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return null;
}

/**
 * How a crate reads before anybody sorts it: newest first.
 *
 * This is the Discogs default too, and it is the right one — a collection is
 * a thing you are always adding to, so the end of it is the part you have not
 * finished thinking about. The alternative was the order IndexedDB hands
 * back, which is by release id and tells you nothing.
 *
 * It costs nothing at sync time. The dates already sit in the summary index
 * from the collection and wantlist endpoints, and the ordering is one
 * in-memory sort of an array the app has already built — the same work any
 * other column does. Nothing about indexing or sync timing changes.
 */
export const DEFAULT_SORT: SortState = { key: "added", direction: "desc" };

/**
 * Which way round a column wants to start.
 *
 * Text reads A–Z. Tempo reads slowest-first, because that is how a set is
 * built. Year reads oldest-first. Length reads shortest-first. None of these
 * are arbitrary — they are the direction you almost always want on the first
 * click, and getting them wrong means every use costs two clicks.
 *
 * Added is the one that reads *newest*-first, and it is the exception for a
 * reason: nobody sorting by date added wants the record they bought in 2011.
 * They want the one that turned up this week.
 */
export function naturalDirection(key: SortKey): SortDirection {
  switch (key) {
    case "added":
      return "desc";
    case "title":
    case "artist":
    case "label":
      return "asc";
    case "year":
    case "bpm":
    case "duration":
      return "asc";
  }
}
