/**
 * The last search, remembered on the device.
 *
 * The other half of "pick up where you left off" (client/resume.ts): a phone
 * that reloads the page in the background loses the search you were in the
 * middle of, and a search is the thing you were *doing*. The query, the
 * field and the results come back as they were, without asking Discogs
 * again — one of sixty requests a minute, spent on a page you already had.
 *
 * What is kept: the words typed, which field, and the result rows Discogs
 * returned (public catalogue data). Checked on the way back in, every
 * field, because localStorage is writable by anything on this origin:
 * a malformed note is an empty one, never an exception at boot. Dropped
 * after twelve hours and on sign-out.
 */

import type { SearchHit } from "@/lib/discogs";
import { SEARCH_FIELDS, type SearchField } from "./searchFields";

export const SEARCH_MEMORY_KEY = "gt_search_v1";
export const SEARCH_MEMORY_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const MAX_HITS = 100;
const MAX_TEXT = 300;

export interface RememberedSearch {
  query: string;
  field: SearchField;
  hits: SearchHit[];
  at: number;
}

export function serializeSearch(memory: Omit<RememberedSearch, "at">, now: number): string {
  return JSON.stringify({ v: 1, at: now, query: memory.query, field: memory.field, hits: memory.hits.slice(0, MAX_HITS) });
}

const text = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === "string" && value.length <= max ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((s): s is string => typeof s === "string" && s.length <= MAX_TEXT).slice(0, 20) : [];
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** One remembered hit, checked field by field; null when it isn't one. */
function hitFrom(value: unknown): SearchHit | null {
  if (typeof value !== "object" || value === null) return null;
  const h = value as Record<string, unknown>;
  if (typeof h.id !== "number" || !Number.isInteger(h.id) || h.id <= 0) return null;
  const artist = text(h.artist);
  const title = text(h.title);
  if (artist === null || title === null) return null;
  return {
    id: h.id,
    artist,
    title,
    year: typeof h.year === "number" && Number.isInteger(h.year) ? h.year : null,
    thumb: typeof h.thumb === "string" && /^https:\/\//.test(h.thumb) && h.thumb.length <= 500 ? h.thumb : "",
    labels: strings(h.labels),
    genres: strings(h.genres),
    styles: strings(h.styles),
    country: text(h.country, 80),
    formats: strings(h.formats),
    catno: text(h.catno, 80),
    barcodes: strings(h.barcodes),
    have: count(h.have),
    want: count(h.want),
  };
}

export function parseSearch(raw: string | null | undefined, now: number): RememberedSearch | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.v !== 1) return null;
  if (typeof d.at !== "number" || !Number.isFinite(d.at)) return null;
  if (now - d.at > SEARCH_MEMORY_MAX_AGE_MS || d.at > now + 60_000) return null;
  const query = text(d.query);
  if (query === null || query.trim() === "") return null;
  const field = SEARCH_FIELDS.find((f) => f.key === d.field)?.key;
  if (!field) return null;
  if (!Array.isArray(d.hits)) return null;
  const hits = d.hits.slice(0, MAX_HITS).map(hitFrom).filter((h): h is SearchHit => h !== null);
  return { query, field, hits, at: d.at };
}

export function readSearch(now = Date.now()): RememberedSearch | null {
  try {
    return parseSearch(window.localStorage.getItem(SEARCH_MEMORY_KEY), now);
  } catch {
    return null;
  }
}

export function writeSearch(memory: Omit<RememberedSearch, "at">, now = Date.now()): void {
  try {
    window.localStorage.setItem(SEARCH_MEMORY_KEY, serializeSearch(memory, now));
  } catch {
    /* private mode or a full store: the search is simply not remembered */
  }
}

export function forgetSearch(): void {
  try {
    window.localStorage.removeItem(SEARCH_MEMORY_KEY);
  } catch {
    /* nothing to forget */
  }
}
