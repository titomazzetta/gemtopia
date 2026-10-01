/**
 * Chat on a collaborative playlist: the pure rules.
 *
 * No database and no environment here, so every rule is tested directly
 * (scripts/test-chat.mjs). The SQL is in repo.ts; the routes are thin.
 *
 * What "sanitising" means for this feature, precisely, because it is easy to
 * do the wrong thing in its name:
 *
 *   * SQL injection is not handled here, and must not be. Every statement
 *     that touches a message is parameterised ($1, $2 …), so a message is
 *     data to Postgres whatever it contains. Escaping quotes by hand would
 *     add nothing and would corrupt what people typed.
 *   * Script injection (XSS) is not handled here either. Messages are shown
 *     as React text children — escaped on output, never parsed as HTML, no
 *     dangerouslySetInnerHTML, no Markdown, no auto-linked URLs. The CSP is
 *     the second wall. Stripping `<` on input would only mangle "<3".
 *   * What *is* done here is normalising the text itself, so that what is
 *     stored is what everyone sees: no invisible characters that make a
 *     message read differently from what it is (bidi overrides — the
 *     "Trojan Source" trick — zero-width spaces, BOMs), no control
 *     characters, no broken UTF-16, no stacks of combining marks drawn over
 *     the rest of the chat, and a hard length measured the way Postgres
 *     measures it, so the database CHECK agrees with the counter people see.
 */

/** Hard cap, in characters (Unicode code points), after normalising. */
export const MAX_MESSAGE_CHARS = 500;

/** Longer than this and the rest of the lines are run together. */
export const MAX_MESSAGE_LINES = 20;

/** Messages per page, newest first from the server. */
export const MESSAGE_PAGE = 50;

/**
 * Only the newest this many are kept per playlist. A chat about a set, not an
 * archive — and a bound on what anyone can make the database hold.
 */
export const MAX_MESSAGES_KEPT = 1000;

/** Most messages one person can post in a minute, counted in the database. */
export const MAX_MESSAGES_PER_MINUTE = 20;

// A high surrogate not followed by a low one, or a low one not preceded by a
// high one. JSON can carry these; Postgres cannot store them.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// C0 and C1 control characters, except the newline.
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/*
 * Characters that change how text is drawn without being seen: bidi
 * embeddings, overrides and isolates (U+202A–202E, U+2066–2069), the
 * directional marks, zero-width space, word joiner and invisible operators
 * (U+2060–2064), soft hyphen, BOM, and interlinear annotation marks.
 * Zero-width *joiner* (U+200D) is kept — emoji sequences need it.
 */
const INVISIBLE = /[­​‎‏‪-‮⁠-⁤⁦-⁩﻿￹-￻]/g;

// More than four combining marks on one character is "Zalgo" text, drawn over
// the lines above and below. Real scripts and emoji keycaps need far fewer.
const MARK_STACK = /(\p{M}{4})\p{M}+/gu;

/** Length the way Postgres's char_length counts it: code points. */
export function messageLength(text: string): number {
  return Array.from(text).length;
}

export type NormalisedMessage =
  | { ok: true; body: string }
  | { ok: false; reason: "empty" | "too_long" };

/**
 * The one form a message is stored in. Anything that is not a string, is
 * empty once cleaned, or is over the limit is refused — never truncated, so
 * nobody's message is silently cut short.
 */
export function normaliseMessage(input: unknown): NormalisedMessage {
  if (typeof input !== "string") return { ok: false, reason: "empty" };

  let text = input
    .replace(LONE_SURROGATE, "�")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .replace(MARK_STACK, "$1");

  // Trailing spaces off every line; runs of blank lines down to one.
  let lines = text.split("\n").map((line) => line.replace(/\s+$/u, ""));
  lines = lines.filter((line, i) => line !== "" || (i > 0 && lines[i - 1] !== ""));
  if (lines.length > MAX_MESSAGE_LINES) {
    const kept = lines.slice(0, MAX_MESSAGE_LINES - 1);
    const rest = lines.slice(MAX_MESSAGE_LINES - 1).filter(Boolean).join(" ");
    lines = [...kept, rest];
  }
  text = lines.join("\n").trim();

  if (text === "") return { ok: false, reason: "empty" };
  if (messageLength(text) > MAX_MESSAGE_CHARS) return { ok: false, reason: "too_long" };
  return { ok: true, body: text };
}

/**
 * A message id as it travels: the decimal form of a positive BIGINT. Checked
 * before it reaches a query, so a malformed one is a 404 and never a
 * database cast error.
 */
export function isMessageId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,17}$/.test(value);
}

/**
 * Who can take a message down: whoever wrote it, and the playlist's owner —
 * the same shape as records, where the owner has the last word.
 */
export function canDeleteMessage(role: "owner" | "editor", mine: boolean): boolean {
  return mine || role === "owner";
}

/* ------------------------------------------------------------------ */
/* Activity notes                                                      */
/* ------------------------------------------------------------------ */

/*
 * Small centred lines in the chat — "komron added Shiva — Kerri Chandler" —
 * written by the server when the set changes or someone joins or leaves.
 * Nobody can post one: the POST schema takes only { body }, and `kind` and
 * `meta` are set in repo.ts from rows the server already holds. What they
 * name (titles, artists) did come from people's edits once, so it is cleaned
 * here the same way a message is, and it is drawn as text like a message.
 */

export type ActivityKind = "added" | "removed" | "joined" | "left";
export type MessageKind = "text" | ActivityKind;

export interface ActivityMeta {
  /** One record: what it is. */
  clipKey?: string;
  title?: string;
  artist?: string;
  year?: number | null;
  /** BPM from the catalogue of whoever added it, when they had measured it. */
  bpm?: number | null;
  /** removed: whose record it was. */
  addedBy?: string | null;
  /** Several records in one edit: how many. */
  count?: number;
  /** left: taken off by the owner, rather than leaving. */
  removed?: boolean;
}

/** More records than this in one edit become one "added 12 records" line. */
export const ACTIVITY_SINGLE_MAX = 3;

/**
 * A record's title or artist, made safe to show in a one-line note: the same
 * cleaning as a message, on one line, and cut to `max` characters (a label
 * may be shortened; a message never is).
 */
export function cleanLabel(input: unknown, max = 120): string {
  if (typeof input !== "string") return "";
  // Cut first (by code point, so no emoji is split) to well under the
  // message limit, so cleaning can only fail on "nothing left".
  const oneLine = Array.from(input.replace(/[\r\n]+/g, " ")).slice(0, 400).join("");
  const cleaned = normaliseMessage(oneLine);
  if (!cleaned.ok) return "";
  const chars = Array.from(cleaned.body);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : cleaned.body;
}

export interface RecordRef {
  clipKey: string;
  title: string;
  artist: string;
  year: number | null;
  /** Username of whoever added it, where known. */
  addedBy?: string | null;
}

/**
 * What an edit added and removed, as records — a multiset difference by clip
 * key, so a reorder is neither, and a record in the list twice that loses a
 * copy is one removal.
 */
export function diffRecords(
  previous: readonly RecordRef[],
  next: readonly RecordRef[],
): { added: RecordRef[]; removed: RecordRef[] } {
  const before = new Map<string, number>();
  for (const r of previous) before.set(r.clipKey, (before.get(r.clipKey) ?? 0) + 1);
  const after = new Map<string, number>();
  for (const r of next) after.set(r.clipKey, (after.get(r.clipKey) ?? 0) + 1);

  const added: RecordRef[] = [];
  const seenNext = new Map<string, number>();
  for (const r of next) {
    const n = (seenNext.get(r.clipKey) ?? 0) + 1;
    seenNext.set(r.clipKey, n);
    if (n > (before.get(r.clipKey) ?? 0)) added.push(r);
  }

  const removed: RecordRef[] = [];
  const seenPrev = new Map<string, number>();
  for (const r of previous) {
    const n = (seenPrev.get(r.clipKey) ?? 0) + 1;
    seenPrev.set(r.clipKey, n);
    if (n > (after.get(r.clipKey) ?? 0)) removed.push(r);
  }
  return { added, removed };
}

export interface ActivityNote {
  kind: ActivityKind;
  /** Plain-text summary, for screen readers and anything that can't draw meta. */
  body: string;
  meta: ActivityMeta;
}

function recordNote(
  kind: "added" | "removed",
  r: RecordRef,
  bpm: number | null,
): ActivityNote {
  const title = cleanLabel(r.title) || "Untitled";
  const artist = cleanLabel(r.artist);
  const meta: ActivityMeta = { clipKey: r.clipKey, title, artist, year: r.year ?? null };
  if (kind === "added") meta.bpm = bpm;
  if (kind === "removed") meta.addedBy = r.addedBy ? cleanLabel(r.addedBy, 64) : null;
  return { kind, body: artist ? `${title} — ${artist}` : title, meta };
}

/**
 * The notes one edit produces: a line per record for a few, one summary
 * line for many (an import or a big paste should not flood the chat).
 */
export function activityNotes(
  added: readonly RecordRef[],
  removed: readonly RecordRef[],
  bpmByKey: ReadonlyMap<string, number> = new Map(),
): ActivityNote[] {
  const notes: ActivityNote[] = [];
  if (added.length > ACTIVITY_SINGLE_MAX) {
    notes.push({ kind: "added", body: `${added.length} records`, meta: { count: added.length } });
  } else {
    for (const r of added) notes.push(recordNote("added", r, bpmByKey.get(r.clipKey) ?? null));
  }
  if (removed.length > ACTIVITY_SINGLE_MAX) {
    notes.push({ kind: "removed", body: `${removed.length} records`, meta: { count: removed.length } });
  } else {
    for (const r of removed) notes.push(recordNote("removed", r, null));
  }
  return notes;
}
