/**
 * Chat on collaborative playlists: the text rules (src/lib/chat.ts) and how
 * the chat is kept and drawn (src/client/chatView.ts).
 *
 *   npm run test:chat
 *
 * Who can read, post and delete is enforced in SQL and tested against a real
 * database in test-api.mjs.
 */
import assert from "node:assert/strict";
import {
  ACTIVITY_SINGLE_MAX,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_LINES,
  activityNotes,
  canDeleteMessage,
  cleanLabel,
  diffRecords,
  isMessageId,
  messageLength,
  normaliseMessage,
} from "../src/lib/chat.ts";
import {
  describeNote,
  groupRuns,
  hasUnread,
  mergeLatest,
  prependOlder,
  totalUnread,
  unreadBadge,
} from "../src/client/chatView.ts";

let ran = 0;
let failed = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

const body = (input) => {
  const r = normaliseMessage(input);
  return r.ok ? r.body : r.reason;
};

/* ---------------- what gets stored ---------------- */

check("ordinary text is kept exactly", () => {
  for (const text of [
    "Swap 4 and 5 — the key clash is rough",
    "Move the Theo Parrish up <3",
    "it's \"fine\" & 100% ok; DROP TABLE users; --",
    "<script>alert(1)</script>",
    "¡Qué bueno! 日本語 🔥🎛️ 👩🏽‍🎤",
  ]) {
    assert.equal(body(text), text, text);
  }
});

check("markup and SQL are data, not something to strip", () => {
  // Parameterised queries and React's escaping are the defences; mangling
  // what people typed would add nothing.
  assert.equal(body("<b>bold</b>"), "<b>bold</b>");
  assert.equal(body("'; DELETE FROM playlist_messages; --"), "'; DELETE FROM playlist_messages; --");
});

check("empty and whitespace-only messages are refused", () => {
  for (const v of ["", "   ", "\n\n\t", "​‮", "\u0000\u0007"]) {
    assert.equal(body(v), "empty", JSON.stringify(v));
  }
});

check("anything that isn't a string is refused", () => {
  for (const v of [null, undefined, 42, {}, ["hi"], true]) {
    assert.equal(body(v), "empty", String(v));
  }
});

check("the limit is 500 characters, counted as Postgres counts them", () => {
  assert.equal(MAX_MESSAGE_CHARS, 500);
  assert.equal(body("a".repeat(500)).length, 500);
  assert.equal(body("a".repeat(501)), "too_long");
  // 500 emoji are 1000 UTF-16 units but 500 characters.
  const fire = "🔥".repeat(500);
  assert.equal(messageLength(fire), 500);
  assert.equal(body(fire), fire);
  assert.equal(body(fire + "🔥"), "too_long");
});

check("too long is refused, never silently cut", () => {
  assert.equal(normaliseMessage("x".repeat(10_000)).ok, false);
});

check("bidi overrides and invisible characters are removed (Trojan Source)", () => {
  assert.equal(body("pay ‮gnp.exe"), "pay gnp.exe");
  assert.equal(body("a⁦b⁩c"), "abc");
  assert.equal(body("zero​width"), "zerowidth");
  assert.equal(body("﻿bom"), "bom");
  assert.equal(body("soft­hyphen"), "softhyphen");
});

check("emoji joiners survive", () => {
  const family = "👨‍👩‍👧";
  assert.equal(body(family), family);
  assert.equal(body("1️⃣"), "1️⃣");
});

check("control characters go; tabs become spaces; CRLF becomes a newline", () => {
  assert.equal(body("a\u0000b\u0007c\u001Bd\u009Fe"), "abcde");
  assert.equal(body("a\tb"), "a b");
  assert.equal(body("one\r\ntwo\rthree"), "one\ntwo\nthree");
});

check("broken UTF-16 is replaced, not stored", () => {
  assert.equal(body("a\uD800b"), "a�b");
  assert.equal(body("a\uDC00b"), "a�b");
});

check("stacks of combining marks are cut down (no Zalgo)", () => {
  const zalgo = "e" + "́".repeat(40);
  const out = body(zalgo);
  assert.equal(messageLength(out), 5, "the letter and four marks");
});

check("text is stored in one Unicode form", () => {
  // "é" as e + combining acute becomes the single character.
  assert.equal(body("café"), "café");
});

check("blank lines collapse; trailing space goes; the ends are trimmed", () => {
  assert.equal(body("  one  \n\n\n\ntwo   \n"), "one\n\ntwo");
});

check("a wall of lines is folded to the line limit", () => {
  const many = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
  const out = body(many);
  assert.equal(out.split("\n").length, MAX_MESSAGE_LINES);
  assert.ok(out.endsWith("line 59"));
});

check("normalising is stable", () => {
  for (const text of ["a‮b\r\n\n\nc  ", "e" + "́".repeat(9), "plain"]) {
    const once = body(text);
    assert.equal(body(once), once);
  }
});

/* ---------------- ids and permissions ---------------- */

check("message ids are positive decimal BIGINTs and nothing else", () => {
  for (const v of ["1", "42", "999999999999999999"]) assert.ok(isMessageId(v), v);
  for (const v of ["0", "-1", "01", "1.5", "1e3", "abc", "1; DROP TABLE x", "", "9999999999999999999", 1, null]) {
    assert.equal(isMessageId(v), false, String(v));
  }
});

check("you can delete your own messages; the owner can delete any", () => {
  assert.equal(canDeleteMessage("editor", true), true);
  assert.equal(canDeleteMessage("editor", false), false);
  assert.equal(canDeleteMessage("owner", false), true);
  assert.equal(canDeleteMessage("owner", true), true);
});

/* ---------------- keeping and drawing the chat ---------------- */

const msg = (id, author, at, mine = false) => ({ id: String(id), author, body: `m${id}`, at, mine });
const T = new Date(2026, 8, 30, 21, 0).getTime();

check("the latest page is folded in oldest first", () => {
  const out = mergeLatest([], [msg(3, "a", T), msg(2, "a", T), msg(1, "a", T)]);
  assert.deepEqual(out.map((m) => m.id), ["1", "2", "3"]);
});

check("ids are compared as numbers, not text", () => {
  const out = mergeLatest([], [msg(10, "a", T), msg(9, "a", T)]);
  assert.deepEqual(out.map((m) => m.id), ["9", "10"]);
});

check("a deleted message disappears on the next poll", () => {
  const shown = [msg(1, "a", T), msg(2, "b", T), msg(3, "a", T)];
  const out = mergeLatest(shown, [msg(3, "a", T), msg(1, "a", T)]);
  assert.deepEqual(out.map((m) => m.id), ["1", "3"]);
});

check("older history you scrolled back to is kept", () => {
  const shown = [msg(5, "a", T), msg(60, "a", T), msg(61, "a", T)];
  const out = mergeLatest(shown, [msg(62, "b", T), msg(61, "a", T), msg(60, "a", T)]);
  assert.deepEqual(out.map((m) => m.id), ["5", "60", "61", "62"]);
});

check("an empty latest page means an empty chat", () => {
  assert.deepEqual(mergeLatest([msg(1, "a", T)], []), []);
});

check("an older page goes in front, without duplicates", () => {
  const out = prependOlder([msg(3, "a", T), msg(4, "a", T)], [msg(2, "a", T), msg(3, "a", T), msg(1, "a", T)]);
  assert.deepEqual(out.map((m) => m.id), ["1", "2", "3", "4"]);
});

check("unread is newer than what this browser has seen", () => {
  assert.equal(hasUnread(null, null), false);
  assert.equal(hasUnread("5", null), true);
  assert.equal(hasUnread("5", "5"), false);
  assert.equal(hasUnread("10", "9"), true, "numeric, not text");
  assert.equal(hasUnread("9", "10"), false);
});

check("consecutive messages from one person are one run", () => {
  const runs = groupRuns(
    [msg(1, "a", T), msg(2, "a", T + 60_000), msg(3, "b", T + 120_000), msg(4, "a", T + 180_000)],
    T,
  );
  assert.deepEqual(runs.map((r) => r.messages.map((m) => m.id)), [["1", "2"], ["3"], ["4"]]);
});

check("a long pause starts a new run", () => {
  const runs = groupRuns([msg(1, "a", T), msg(2, "a", T + 10 * 60_000)], T);
  assert.equal(runs.length, 2);
});

check("each day gets one divider", () => {
  const yesterday = T - 86_400_000;
  const runs = groupRuns([msg(1, "a", yesterday), msg(2, "b", yesterday + 1000), msg(3, "a", T)], T);
  assert.deepEqual(runs.map((r) => r.day), ["Yesterday", null, "Today"]);
});


/* ---------------- activity notes ---------------- */

const rec = (key, title = `T${key}`, addedBy = null) => ({
  clipKey: `${key}:aaaaaaaaaaa`,
  title,
  artist: `A${key}`,
  year: 1998,
  addedBy,
});

check("a reorder adds and removes nothing", () => {
  const { added, removed } = diffRecords([rec(1), rec(2), rec(3)], [rec(3), rec(1), rec(2)]);
  assert.equal(added.length, 0);
  assert.equal(removed.length, 0);
});

check("adds and removals are found by record, not position", () => {
  const { added, removed } = diffRecords([rec(1), rec(2, "Two", "tito")], [rec(3), rec(1)]);
  assert.deepEqual(added.map((r) => r.clipKey), ["3:aaaaaaaaaaa"]);
  assert.deepEqual(removed.map((r) => r.clipKey), ["2:aaaaaaaaaaa"]);
  assert.equal(removed[0].addedBy, "tito");
});

check("a second copy of a record is an add; losing one is a removal", () => {
  assert.equal(diffRecords([rec(1)], [rec(1), rec(1)]).added.length, 1);
  assert.equal(diffRecords([rec(1), rec(1)], [rec(1)]).removed.length, 1);
});

check("a few records get a line each, with what they are", () => {
  const notes = activityNotes([rec(1, "Shiva")], [], new Map([["1:aaaaaaaaaaa", 124]]));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "added");
  assert.equal(notes[0].body, "Shiva — A1");
  assert.deepEqual(notes[0].meta, {
    clipKey: "1:aaaaaaaaaaa",
    title: "Shiva",
    artist: "A1",
    year: 1998,
    bpm: 124,
  });
});

check("many records in one edit are one line, not a flood", () => {
  const many = Array.from({ length: ACTIVITY_SINGLE_MAX + 5 }, (_, i) => rec(i + 1));
  const notes = activityNotes(many, many.slice(0, 1));
  assert.equal(notes.length, 2);
  assert.deepEqual(notes[0].meta, { count: ACTIVITY_SINGLE_MAX + 5 });
  assert.equal(notes[1].kind, "removed");
});

check("a removal says whose record it was", () => {
  const [note] = activityNotes([], [rec(2, "Two", "komron")]);
  assert.equal(note.kind, "removed");
  assert.equal(note.meta.addedBy, "komron");
  assert.ok(!("bpm" in note.meta));
});

check("titles in notes are cleaned like messages, and kept short", () => {
  assert.equal(cleanLabel("Pay\u202Emp3.exe\nline two"), "Paymp3.exe line two");
  assert.equal(cleanLabel("<b>x</b>"), "<b>x</b>", "still just text");
  const long = cleanLabel("x".repeat(1000));
  assert.equal(Array.from(long).length, 120);
  assert.ok(long.endsWith("…"));
  assert.equal(cleanLabel(null), "");
  const [note] = activityNotes([rec(1, "\u200B\u202E")], []);
  assert.equal(note.meta.title, "Untitled");
});

const note = (id, kind, meta, author = "komron", mine = false) => ({
  id: String(id),
  kind,
  meta,
  author,
  body: "x",
  at: T,
  mine,
});

check("an added note reads as who, what, and the details", () => {
  const v = describeNote(
    note(1, "added", { clipKey: "1:aaaaaaaaaaa", title: "Shiva", artist: "Kerri Chandler", year: 1998, bpm: 124.4 }),
    { duration: 372, bpm: 120 },
  );
  assert.equal(v.who, "komron");
  assert.equal(v.verb, "added");
  assert.equal(v.title, "Shiva");
  assert.deepEqual(v.details, ["1998", "124 BPM", "6:12"], "their BPM wins over yours");
});

check("without their BPM, yours fills in; unknown details are left out", () => {
  const v = describeNote(note(1, "added", { clipKey: "k", title: "S", artist: "A", year: null, bpm: null }), {
    duration: null,
    bpm: 118,
  });
  assert.deepEqual(v.details, ["118 BPM"]);
});

check("your own note says You; summaries, joins and leaves read plainly", () => {
  assert.equal(describeNote(note(1, "joined", {}, "tito", true)).who, "You");
  assert.equal(describeNote(note(1, "added", { count: 12 })).verb, "added 12 records");
  assert.equal(describeNote(note(1, "left", { removed: false })).verb, "left");
  assert.equal(describeNote(note(1, "left", { removed: true })).verb, "was taken off the playlist");
  const r = describeNote(note(1, "removed", { title: "S", artist: "A", addedBy: "tito" }, "komron"));
  assert.equal(r.verb, "took out");
  assert.deepEqual(r.details, ["added by tito"]);
});

check("notes are their own runs, never folded into someone's messages", () => {
  const runs = groupRuns(
    [
      { ...msg(1, "a", T), kind: "text" },
      { ...msg(2, "a", T + 1000), kind: "added", meta: {} },
      { ...msg(3, "a", T + 2000), kind: "text" },
    ],
    T,
  );
  assert.deepEqual(runs.map((r) => r.note), [false, true, false]);
});

check("unread adds up across playlists, and badges stop at 99+", () => {
  assert.equal(totalUnread([{ unread: 2 }, { unread: 0 }, { unread: 5 }, {}]), 7);
  assert.equal(unreadBadge(0), "0");
  assert.equal(unreadBadge(7), "7");
  assert.equal(unreadBadge(99), "99+");
  assert.equal(unreadBadge(250), "99+");
});

console.log(`\n${ran - failed}/${ran} chat tests passed.`);
if (failed > 0) process.exit(1);
