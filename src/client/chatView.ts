/**
 * How the chat is kept and drawn. Pure, so it is tested
 * (scripts/test-chat.mjs).
 */

import type { ChatMessage } from "@/lib/types";

/** Ids are decimal BIGINTs; compare them as numbers, not strings. */
function idOrder(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Fold the latest page from the server into what is on screen.
 *
 * The latest page is the truth for everything from its oldest message on:
 * anything in that range that is missing from it was deleted. Older history
 * you scrolled back to (via "earlier") is kept as it is. An empty latest page
 * means the chat is empty. Returned oldest first, the order it is drawn in.
 */
export function mergeLatest(existing: readonly ChatMessage[], latest: readonly ChatMessage[]): ChatMessage[] {
  if (latest.length === 0) return [];
  const sorted = [...latest].sort((a, b) => idOrder(a.id, b.id));
  const floor = sorted[0]!.id;
  const older = existing.filter((m) => idOrder(m.id, floor) < 0);
  return [...older, ...sorted];
}

/** Add an older page (from "earlier") in front of what is on screen. */
export function prependOlder(existing: readonly ChatMessage[], older: readonly ChatMessage[]): ChatMessage[] {
  const seen = new Set(existing.map((m) => m.id));
  const fresh = older.filter((m) => !seen.has(m.id));
  return [...fresh, ...existing].sort((a, b) => idOrder(a.id, b.id));
}

/** Is there a message newer than the last one this person has seen? */
export function hasUnread(lastMessageId: string | null, lastSeenId: string | null): boolean {
  if (!lastMessageId) return false;
  if (!lastSeenId) return true;
  return idOrder(lastMessageId, lastSeenId) > 0;
}

export interface MessageRun {
  /** Key for React: the first message's id. */
  key: string;
  author: string | null;
  mine: boolean;
  /** A run of activity notes ("komron added …"), drawn centred and small. */
  note: boolean;
  messages: ChatMessage[];
  /** Set on the first run of a new day, e.g. "Today", "Yesterday", "Mon 28 Sep". */
  day: string | null;
}

/** Messages this close together from the same person share one name label. */
const RUN_GAP_MS = 5 * 60_000;

function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function dayLabel(at: number, now: number = Date.now()): string {
  const key = dayKey(at);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(now - 86_400_000)) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Telegram-style grouping: consecutive messages from one person, a few
 * minutes apart at most, are one run with the name shown once; a new day
 * gets a divider.
 */
export function groupRuns(messages: readonly ChatMessage[], now: number = Date.now()): MessageRun[] {
  const runs: MessageRun[] = [];
  let lastDay: string | null = null;
  for (const message of messages) {
    const day = dayKey(message.at);
    const newDay = day !== lastDay;
    lastDay = day;
    const note = message.kind !== undefined && message.kind !== "text";
    const previous = runs[runs.length - 1];
    const last = previous?.messages[previous.messages.length - 1];
    if (
      previous &&
      last &&
      !newDay &&
      previous.note === note &&
      previous.author === message.author &&
      previous.mine === message.mine &&
      message.at - last.at <= RUN_GAP_MS
    ) {
      previous.messages.push(message);
      continue;
    }
    runs.push({
      key: message.id,
      author: message.author,
      mine: message.mine,
      note,
      messages: [message],
      day: newDay ? dayLabel(message.at, now) : null,
    });
  }
  return runs;
}

/** What this browser knows about a record, to fill in a note. */
export interface KnownRecord {
  /** Seconds. */
  duration: number | null;
  bpm: number | null;
}

export interface NoteView {
  /** "You", the person's name, or "Former member". */
  who: string;
  /** "added", "took out", "joined" … */
  verb: string;
  title: string | null;
  artist: string | null;
  /** Small print under the line: year · BPM · length, or whose it was. */
  details: string[];
  /** The record the note is about, when it is one record. */
  clipKey: string | null;
}

function length(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * How an activity note reads. The BPM is the one the person who added the
 * record had measured, if they had; otherwise your own, if you have. The
 * length comes from what this browser already knows about the record.
 */
export function describeNote(message: ChatMessage, known?: KnownRecord | null): NoteView {
  const meta = message.meta ?? {};
  const who = message.mine ? "You" : (message.author ?? "Former member");
  const base = { who, title: null, artist: null, details: [] as string[], clipKey: null };

  switch (message.kind) {
    case "joined":
      return { ...base, verb: "joined" };
    case "left":
      return { ...base, verb: meta.removed ? "was taken off the playlist" : "left" };
    case "added":
    case "removed": {
      const verb = message.kind === "added" ? "added" : "took out";
      if (typeof meta.count === "number") {
        return { ...base, verb: `${verb} ${meta.count} records` };
      }
      const details: string[] = [];
      if (message.kind === "added") {
        if (meta.year) details.push(String(meta.year));
        const bpm = meta.bpm ?? known?.bpm ?? null;
        if (bpm) details.push(`${Math.round(bpm)} BPM`);
        if (known?.duration) details.push(length(known.duration));
      } else if (meta.addedBy && meta.addedBy !== message.author) {
        details.push(`added by ${meta.addedBy}`);
      }
      return {
        who,
        verb,
        title: meta.title ?? null,
        artist: meta.artist || null,
        details,
        clipKey: meta.clipKey ?? null,
      };
    }
    default:
      return { ...base, verb: "" };
  }
}

/** Unread chat across every playlist you're on. */
export function totalUnread(playlists: ReadonlyArray<{ unread?: number }>): number {
  return playlists.reduce((n, p) => n + (p.unread ?? 0), 0);
}

/**
 * The number on a badge. The server stops counting at 99 per playlist
 * (chat.UNREAD_CAP), so 99 or more reads "99+".
 */
export function unreadBadge(count: number): string {
  return count >= 99 ? "99+" : String(Math.max(0, Math.floor(count)));
}
