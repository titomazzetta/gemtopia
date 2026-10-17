/**
 * Your tags: their one stored form, the suggestions, the saves, and where
 * they can't go.
 *
 *   npm run test:tags
 *
 * The form matters twice over. The browser and the server both clean a tag
 * with lib/tags.ts, and the database then refuses anything else with CHECKs
 * of its own — so a cleaned tag the database would refuse is a save that
 * fails for no reason the user can see. The fuzz below runs thousands of
 * hostile strings through the cleaner and holds every result to a JavaScript
 * copy of those CHECKs.
 *
 * The privacy promise ("only you see them") is pinned the same way the write
 * surface is (test-write-surface.mjs): by reading the source. The table has
 * exactly two readers and writers, both in repo.ts, reached from exactly one
 * route; the builders of playlist entries and export files can't carry a tag.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  normaliseTag,
  normaliseTags,
  rankTags,
  sortTags,
  suggestTags,
  tagHaystack,
  withTags,
  STARTER_TAGS,
  TAG_MAX_CHARS,
  TAGS_PER_TRACK,
} from "../src/lib/tags.ts";
import { serialWrites } from "../src/client/serialWrites.ts";
import { fileEntry } from "../src/client/playlistFile.ts";
import { playlistItemSchema, trackTagsSchema } from "../src/lib/validation.ts";

let ran = 0;
let failed = 0;
const pending = [];

function check(name, fn) {
  ran += 1;
  const run = async () => {
    try {
      await fn();
    } catch (error) {
      failed += 1;
      console.error(`FAIL  ${name}\n      ${error.message}`);
    }
  };
  pending.push(run());
}

const tag = (raw) => {
  const result = normaliseTag(raw);
  return result.ok ? result.tag : `!${result.reason}`;
};

/* ---------------- one tag's form ---------------- */

check("lower case, one space, no edges", () => {
  assert.equal(tag("Deep"), "deep");
  assert.equal(tag("  Deep   House  "), "deep house");
  assert.equal(tag("PEAK\ttime"), "peak time");
  assert.equal(tag("line\nbreak"), "line break");
});

check("a leading # is how people write a tag, not part of it", () => {
  for (const raw of ["#deep", "##deep", "# deep", "# #deep", " #Deep"]) {
    assert.equal(tag(raw), "deep", JSON.stringify(raw));
  }
  assert.equal(tag("c#minor"), "c#minor", "a # inside stays");
});

check("commas separate tags, so a tag never holds one", () => {
  assert.equal(tag("drum,bass"), "drum bass");
});

check("invisible characters that change how text reads are removed", () => {
  assert.equal(tag("dee\u200Bp"), "deep", "zero-width space");
  assert.equal(tag("\u202Eevil"), "evil", "right-to-left override");
  assert.equal(tag("de\u00ADep"), "deep", "soft hyphen");
  assert.equal(tag("\u2066iso\u2069"), "iso", "bidi isolates");
  assert.equal(tag("\uFEFFbom"), "bom");
  // Emoji sequences need the zero-width joiner, so it stays.
  assert.equal(tag("👩\u200D🎤"), "👩\u200D🎤");
});

check("one canonical form: composed accents, and lone surrogates dropped", () => {
  assert.equal(tag("Café"), "café");
  assert.equal(tag("ÉCOLE"), "école");
  assert.equal(tag("ok\uD800"), "ok");
});

check("Zalgo is cut back to four marks a letter", () => {
  const zalgo = `a${"́".repeat(30)}`;
  assert.equal(Array.from(tag(zalgo)).length, 5);
});

check("nothing visible is no tag", () => {
  for (const raw of ["", "   ", "#", "##", "\u200D", "́́", ",", "\u200B", 42, null, undefined]) {
    assert.equal(tag(raw), "!empty", JSON.stringify(raw));
  }
});

check(`up to ${TAG_MAX_CHARS} characters, counted the way Postgres counts`, () => {
  assert.equal(tag("x".repeat(TAG_MAX_CHARS)), "x".repeat(TAG_MAX_CHARS));
  assert.equal(tag("x".repeat(TAG_MAX_CHARS + 1)), "!too_long");
  // 32 emoji are 64 UTF-16 units and 32 characters: allowed.
  assert.equal(Array.from(tag("🔥".repeat(TAG_MAX_CHARS))).length, TAG_MAX_CHARS);
  assert.equal(tag("🔥".repeat(TAG_MAX_CHARS + 1)), "!too_long");
  assert.equal(tag("x".repeat(5000)), "!too_long", "bounded before any regex runs");
});

/*
 * The database's CHECKs (db/schema.sql, track_tags), in JavaScript. A cleaned
 * tag must pass all of them, or saving it fails.
 */
const DB_FORBIDDEN = /[\u0001-\u001f\u007f-\u009f\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]/u;
function databaseAccepts(value) {
  const length = Array.from(value).length;
  return (
    length >= 1 &&
    length <= 32 &&
    value === value.replace(/^ +| +$/g, "") &&
    !value.startsWith("#") &&
    !/[A-Z,]/.test(value) &&
    !DB_FORBIDDEN.test(value)
  );
}

check("every cleaned tag is one the database accepts, and cleaning it again changes nothing", () => {
  // A fixed seed: the same thousands of strings every run.
  let seed = 0x2f6b9a1;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 2 ** 32;
  };
  const alphabet = [
    "a", "Z", "é", "É", "ß", "İ", "Σ", "ǅ", "#", ",", " ", "\t", "\n", " ", "　",
    "\u200B", "\u200C", "\u200D", "\u200E", "\u202E", "\u2066", "\u00AD", "\uFEFF", "\uFFF9",
    "\u0000", "\u0007", "\u0085", "́", "🔥", "👩\u200D🎤", "\uD800", "\uDC00", "1", "&", "-",
  ];
  let accepted = 0;
  for (let i = 0; i < 5000; i += 1) {
    const length = 1 + Math.floor(random() * 40);
    let raw = "";
    for (let j = 0; j < length; j += 1) raw += alphabet[Math.floor(random() * alphabet.length)];
    const once = normaliseTag(raw);
    if (!once.ok) continue;
    accepted += 1;
    assert.ok(databaseAccepts(once.tag), `the database would refuse ${JSON.stringify(once.tag)} (from ${JSON.stringify(raw)})`);
    const twice = normaliseTag(once.tag);
    assert.ok(twice.ok && twice.tag === once.tag, `not stable: ${JSON.stringify(once.tag)}`);
  }
  assert.ok(accepted > 1000, `only ${accepted} of 5000 made a tag — the fuzz isn't testing much`);
});

/* ---------------- a track's set ---------------- */

check("a set is cleaned, deduplicated and sorted", () => {
  assert.deepEqual(normaliseTags(["Opening", "#deep", "deep", "DEEP "]), { ok: true, tags: ["deep", "opening"] });
  assert.deepEqual(normaliseTags([]), { ok: true, tags: [] });
});

check(`up to ${TAGS_PER_TRACK} a track; one bad tag refuses the lot`, () => {
  const twelve = Array.from({ length: TAGS_PER_TRACK }, (_, i) => `t${String(i).padStart(2, "0")}`);
  assert.equal(normaliseTags(twelve).ok, true);
  assert.deepEqual(normaliseTags([...twelve, "one more"]), { ok: false, reason: "too_many" });
  // Repeats don't count against it.
  assert.equal(normaliseTags([...twelve, ...twelve]).ok, true);
  assert.deepEqual(normaliseTags(["fine", "x".repeat(40)]), { ok: false, reason: "too_long" });
  assert.deepEqual(normaliseTags(["fine", "  "]), { ok: false, reason: "empty" });
  assert.deepEqual(normaliseTags("deep"), { ok: false, reason: "empty" }, "not a list");
  assert.deepEqual(normaliseTags(Array(TAGS_PER_TRACK * 2 + 1).fill("a")), { ok: false, reason: "too_many" });
});

check("sorting is the same on every machine (code points, not a locale)", () => {
  assert.deepEqual(sortTags(["opening", "deep", "closing", "ä", "a"]), ["a", "closing", "deep", "opening", "ä"]);
});

/* ---------------- suggestions and the filter ---------------- */

check("your tags, most used first", () => {
  const ranked = rankTags(
    new Map([
      ["1:aaaaaaaaaaa", ["deep", "opening"]],
      ["2:bbbbbbbbbbb", ["deep"]],
      ["3:t.A1", ["closing", "deep"]],
    ]),
  );
  assert.deepEqual(ranked, [["deep", 3], ["closing", 1], ["opening", 1]]);
});

check("before you have tags, the three starter words are offered", () => {
  assert.deepEqual(suggestTags([], [], "").map(([t]) => t), [...STARTER_TAGS]);
  assert.deepEqual(suggestTags([], ["deep"], "").map(([t]) => t), ["opening", "closing"]);
});

check("suggestions leave out what the track has, and follow what you type", () => {
  const ranked = [["deep", 9], ["deep house", 4], ["opening", 3], ["warm-up", 2], ["sleep", 1]];
  assert.deepEqual(suggestTags(ranked, ["opening"], "").map(([t]) => t), ["deep", "deep house", "warm-up", "sleep"]);
  // Words that start with it first, then ones that merely contain it.
  assert.deepEqual(suggestTags(ranked, [], "ee").map(([t]) => t), ["deep", "deep house", "sleep"]);
  assert.deepEqual(suggestTags(ranked, [], "hou").map(([t]) => t), ["deep house"]);
  assert.deepEqual(suggestTags(ranked, [], "#De").map(([t]) => t), ["deep", "deep house"]);
  assert.equal(suggestTags(ranked, [], "", 2).length, 2);
});

check("search sees your tags as #words", () => {
  assert.equal(tagHaystack(["deep", "warm up"]), "#deep #warm up");
  assert.equal(tagHaystack(undefined), "");
});

check("tags ride along on the tracks that have them, and nothing else changes", () => {
  const items = [{ key: "1:aaaaaaaaaaa", title: "A" }, { key: "2:bbbbbbbbbbb", title: "B" }];
  assert.equal(withTags(items, new Map()), items, "no tags: the same array");
  const tagged = withTags(items, new Map([["2:bbbbbbbbbbb", ["deep"]]]));
  assert.deepEqual(tagged[1].tags, ["deep"]);
  assert.equal(tagged[0], items[0], "untagged tracks are the same objects");
  assert.equal(items[1].tags, undefined, "the input isn't changed");
});

/* ---------------- saves: one at a time per track ---------------- */

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

check("a quick second and third edit wait, and only the newest is sent", async () => {
  const sent = [];
  const calls = [];
  const events = [];
  const writer = serialWrites(
    (key, value) => {
      sent.push([key, value]);
      const d = deferred();
      calls.push(d);
      return d.promise;
    },
    {
      onSaved: (key, result, settled) => events.push(["saved", key, result, settled]),
      onFailed: (key, error, settled) => events.push(["failed", key, error.message, settled]),
    },
  );
  writer.write("a", ["deep"]);
  writer.write("a", ["deep", "opening"]);
  writer.write("a", ["closing", "deep", "opening"]);
  assert.deepEqual(sent, [["a", ["deep"]]], "one request at a time");
  assert.equal(writer.busy("a"), true);

  calls[0].resolve("first");
  await tick();
  assert.deepEqual(events[0], ["saved", "a", "first", false], "not settled: a newer edit is waiting");
  assert.deepEqual(sent[1], ["a", ["closing", "deep", "opening"]], "the middle edit was skipped");

  calls[1].resolve("last");
  await tick();
  assert.deepEqual(events[1], ["saved", "a", "last", true]);
  assert.equal(sent.length, 2);
  assert.equal(writer.busy("a"), false);
});

check("different tracks don't wait for each other; a failure moves on", async () => {
  const calls = new Map();
  const events = [];
  const writer = serialWrites(
    (key) => {
      const d = deferred();
      calls.set(key, [...(calls.get(key) ?? []), d]);
      return d.promise;
    },
    {
      onSaved: (key, _result, settled) => events.push(["saved", key, settled]),
      onFailed: (key, _error, settled) => events.push(["failed", key, settled]),
    },
  );
  writer.write("a", ["deep"]);
  writer.write("b", ["opening"]);
  assert.equal(calls.get("a").length, 1);
  assert.equal(calls.get("b").length, 1, "b went out while a was in flight");

  writer.write("a", ["closing"]);
  calls.get("a")[0].reject(new Error("offline"));
  await tick();
  assert.deepEqual(events[0], ["failed", "a", false], "a newer edit is waiting, so the failure isn't final");
  assert.equal(calls.get("a").length, 2, "the newer edit still goes");
  calls.get("a")[1].resolve({});
  calls.get("b")[0].reject(new Error("offline"));
  await tick();
  assert.deepEqual(events.slice(1).sort(), [["failed", "b", true], ["saved", "a", true]]);
});

/* ---------------- where tags can't go ---------------- */

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

check("the track_tags table is read and written in two functions only", () => {
  const touching = [];
  for (const file of sourceFiles("src")) {
    const code = stripComments(readFileSync(file, "utf8"));
    if (!/\btrack_tags\b/.test(code)) continue;
    if (file !== join("src", "lib", "repo.ts")) {
      touching.push(file);
      continue;
    }
    // Which function each mention sits in.
    const starts = [...code.matchAll(/^export async function (\w+)/gm)].map((m) => [m.index, m[1]]);
    for (const hit of code.matchAll(/\btrack_tags\b/g)) {
      const inside = starts.filter(([at]) => at < hit.index).pop();
      touching.push(inside ? `repo.${inside[1]}` : "repo.ts (outside a function)");
    }
  }
  assert.deepEqual([...new Set(touching)].sort(), ["repo.listTrackTags", "repo.setTrackTags"]);
});

check("and those two are reached from the tags route alone", () => {
  const callers = sourceFiles("src")
    .filter((file) => /\b(?:listTrackTags|setTrackTags)\b/.test(stripComments(readFileSync(file, "utf8"))))
    .filter((file) => file !== join("src", "lib", "repo.ts"));
  assert.deepEqual(callers, [join("src", "app", "api", "track-tags", "route.ts")]);
});

check("an export file can't carry a tag", () => {
  const row = {
    clipKey: "1:aaaaaaaaaaa",
    releaseId: 1,
    videoId: "aaaaaaaaaaa",
    title: "T",
    artist: "A",
    releaseTitle: "R",
    year: 1999,
    tags: ["my secret word"],
  };
  assert.ok(!JSON.stringify(fileEntry(row)).includes("my secret word"));
});

check("the playlist API refuses an entry that tries to bring tags along", () => {
  const entry = {
    clipKey: "1:aaaaaaaaaaa",
    releaseId: 1,
    videoId: "aaaaaaaaaaa",
    title: "T",
    artist: "A",
    releaseTitle: "R",
    year: 1999,
  };
  assert.equal(playlistItemSchema.safeParse(entry).success, true);
  assert.equal(playlistItemSchema.safeParse({ ...entry, tags: ["deep"] }).success, false);
});

check("the tags request is exactly a key and a list", () => {
  assert.equal(trackTagsSchema.safeParse({ clipKey: "1:t.A1", tags: ["deep"] }).success, true);
  assert.equal(trackTagsSchema.safeParse({ clipKey: "1:t.A1", tags: ["deep"], userId: "x" }).success, false);
  assert.equal(trackTagsSchema.safeParse({ clipKey: "../etc", tags: [] }).success, false);
  assert.equal(trackTagsSchema.safeParse({ clipKey: "1:t.A1", tags: "deep" }).success, false);
});

await Promise.all(pending);
console.log(`\n${ran - failed}/${ran} tag tests passed.`);
if (failed > 0) process.exit(1);
