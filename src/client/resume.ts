/**
 * Pick up where you left off.
 *
 * iOS throws a web page out of memory after a while in the background and
 * reloads it fresh when you come back: the record that was playing, the set
 * you had open and the search you were in the middle of all reset to the
 * front door. "When I leave the app and come back, the current search and
 * song playing are not retained" was the note from the first friend to use
 * it on a phone for a week.
 *
 * The fix is a small note on the device — what was open, which clip, how far
 * in — written as you go and read back once on the next load. The clip is
 * then *cued* at that position, never started: autoplay without a tap is
 * refused on phones anyway, and nobody wants a reload to start playing by
 * itself. One tap on play carries on.
 *
 * What is in the note, in full: the username it belongs to, the crate or
 * wantlist, the open playlist's id, the clip's key, the position in seconds,
 * whether the search was open, and when it was written. No track names, no
 * playlist names, no tokens. It lives in this browser's localStorage, it is
 * ignored once it is older than RESUME_MAX_AGE_MS or belongs to someone else,
 * and signing out removes it.
 */

import type { Source } from "@/lib/types";
import { isClipKey } from "@/lib/clipKey";

export const RESUME_KEY = "gt_resume_v1";
/** Twelve hours: a set from this afternoon, not the one from last week. */
export const RESUME_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface ResumeSnapshot {
  v: 1;
  /** Epoch ms when written. */
  at: number;
  /** Whose note this is; another account on the same device starts fresh. */
  user: string;
  source: Source;
  playlistId: string | null;
  /** The clip that was on the decks (lib/clipKey.ts shape), or nothing. */
  key: string | null;
  /** Seconds into the clip. */
  position: number;
  searchOpen: boolean;
}

export function serializeSnapshot(snapshot: Omit<ResumeSnapshot, "v">): string {
  return JSON.stringify({ v: 1, ...snapshot });
}

const isSource = (value: unknown): value is Source => value === "collection" || value === "wantlist";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The note, read back and checked — every field, because localStorage is
 * writable by anything running on this origin and a malformed note must
 * fall back to a normal start rather than throw during boot. Null when there
 * is nothing usable: missing, malformed, too old, or someone else's.
 */
export function parseSnapshot(raw: string | null | undefined, now: number, user: string): ResumeSnapshot | null {
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
  if (now - d.at > RESUME_MAX_AGE_MS || d.at > now + 60_000) return null;
  if (typeof d.user !== "string" || d.user !== user) return null;
  if (!isSource(d.source)) return null;
  const playlistId = d.playlistId === null ? null : typeof d.playlistId === "string" && UUID_SHAPE.test(d.playlistId) ? d.playlistId : null;
  const key = d.key === null ? null : isClipKey(d.key) ? d.key : null;
  const position = typeof d.position === "number" && Number.isFinite(d.position) && d.position >= 0 ? Math.min(d.position, 24 * 3600) : 0;
  return {
    v: 1,
    at: d.at,
    user: d.user,
    source: d.source,
    playlistId,
    key,
    position,
    searchOpen: d.searchOpen === true,
  };
}

export interface ResumePlan {
  source: Source;
  /** Open this set first; null when the clip was playing from the crate. */
  playlistId: string | null;
  /** Cue this clip at this many seconds in; null when nothing was playing. */
  cue: { key: string; position: number } | null;
  searchOpen: boolean;
}

/**
 * What can actually be restored, given what this device holds now. A set
 * that has since been deleted (or belongs to a login this isn't) is not
 * opened; a clip the crate no longer has is not cued; the rest still is.
 * Null when there is nothing to do at all.
 */
export function resumePlan(
  snapshot: ResumeSnapshot | null,
  available: { playlistIds: ReadonlySet<string>; keys: ReadonlySet<string> },
): ResumePlan | null {
  if (!snapshot) return null;
  const playlistId = snapshot.playlistId && available.playlistIds.has(snapshot.playlistId) ? snapshot.playlistId : null;
  const cue = snapshot.key && available.keys.has(snapshot.key) ? { key: snapshot.key, position: snapshot.position } : null;
  if (!playlistId && !cue && !snapshot.searchOpen) return null;
  return { source: snapshot.source, playlistId, cue, searchOpen: snapshot.searchOpen };
}

/** A position worth writing: a change of at least this many seconds. */
export const RESUME_WRITE_EVERY_MS = 5_000;

/** Read the note from this browser. Never throws: a blocked store is an empty one. */
export function readResume(user: string, now = Date.now()): ResumeSnapshot | null {
  try {
    return parseSnapshot(window.localStorage.getItem(RESUME_KEY), now, user);
  } catch {
    return null;
  }
}

export function writeResume(snapshot: Omit<ResumeSnapshot, "v">): void {
  try {
    window.localStorage.setItem(RESUME_KEY, serializeSnapshot(snapshot));
  } catch {
    /* private mode, full store: nothing to pick up next time, which is the old behaviour */
  }
}

export function forgetResume(): void {
  try {
    window.localStorage.removeItem(RESUME_KEY);
  } catch {
    /* nothing to forget */
  }
}
