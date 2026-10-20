/**
 * Clip drag tests.
 *
 *   npm run test:clip-drag
 *
 * A drop target must accept a record dragged from inside the app and nothing
 * else — not a URL or text dragged in from another tab, and not a malformed
 * key that could be passed along somewhere.
 */
import assert from "node:assert/strict";
import {
  CLIP_MIME,
  CLIPS_MAX,
  CLIPS_MIME,
  ROW_MIME,
  isClipDrag,
  isClipKey,
  isRowDrag,
  readClipDrag,
  readClipsDrag,
  readRowDrag,
  writeClipDrag,
  writeClipsDrag,
  writeRowDrag,
} from "../src/client/clipDrag.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

const fake = () => {
  const data = new Map();
  return {
    effectAllowed: "none",
    setData: (type, value) => data.set(type, value),
    getData: (type) => data.get(type) ?? "",
    get types() { return [...data.keys()]; },
    data,
  };
};

check("a real clip key round-trips through a drag", () => {
  const t = fake();
  assert.equal(writeClipDrag(t, "4567:dQw4w9WgXcQ"), true);
  assert.equal(t.effectAllowed, "copyMove");
  assert.equal(isClipDrag(t), true);
  assert.equal(readClipDrag(t), "4567:dQw4w9WgXcQ");
});

check("silent rows and junk never start a drag", () => {
  for (const key of ["4567:silent", "", "abc", "0:dQw4w9WgXcQ", "4567:short", "4567:dQw4w9WgXcQ<script>"]) {
    const t = fake();
    assert.equal(writeClipDrag(t, key), false, key);
    assert.equal(t.data.size, 0);
  }
});

check("text or links dragged in from elsewhere are not ours", () => {
  const t = fake();
  t.setData("text/plain", "4567:dQw4w9WgXcQ");
  t.setData("text/uri-list", "https://example.com");
  assert.equal(isClipDrag(t), false);
  assert.equal(readClipDrag(t), null);
});

check("a tampered value under our type is refused", () => {
  const t = fake();
  t.setData(CLIP_MIME, "4567:dQw4w9WgXcQ; DROP TABLE");
  assert.equal(readClipDrag(t), null);
  assert.equal(readClipDrag(null), null);
  assert.equal(isClipDrag(null), false);
});

check("key shape", () => {
  assert.ok(isClipKey("1:abcdefghijk"));
  assert.ok(!isClipKey("1:abcdefghij"));
  assert.ok(!isClipKey(42));
});

check("a row moved within a playlist carries its index as well as its clip", () => {
  const t = fake();
  assert.equal(writeRowDrag(t, 7), true);
  assert.equal(writeClipDrag(t, "4567:dQw4w9WgXcQ"), true);
  assert.equal(isRowDrag(t), true);
  assert.equal(isClipDrag(t), true, "the same drag still drops onto a playlist in the sidebar");
  assert.equal(readRowDrag(t), 7);
  assert.equal(readClipDrag(t), "4567:dQw4w9WgXcQ");
});

check("a record dragged from the player or the crate is not a row move", () => {
  const t = fake();
  writeClipDrag(t, "4567:dQw4w9WgXcQ");
  assert.equal(isRowDrag(t), false);
  assert.equal(readRowDrag(t), null);
  assert.equal(isRowDrag(null), false);
  assert.equal(readRowDrag(null), null);
});

check("a row index that is not a whole number never starts or lands a move", () => {
  for (const index of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_000]) {
    const t = fake();
    assert.equal(writeRowDrag(t, index), false, String(index));
    assert.equal(t.data.size, 0);
  }
  for (const value of ["", "-1", "1.5", "7; DROP TABLE", "0x10", " 7", "1234567"]) {
    const t = fake();
    t.setData(ROW_MIME, value);
    assert.equal(readRowDrag(t), null, JSON.stringify(value));
  }
});

check("several ticked tracks travel together, beside the grabbed one", () => {
  const t = fake();
  writeClipDrag(t, "4567:dQw4w9WgXcQ");
  assert.equal(writeClipsDrag(t, ["4567:dQw4w9WgXcQ", "12:t.B2", "4567:dQw4w9WgXcQ", "88:aaaaaaaaaaa"]), true);
  assert.deepEqual(readClipsDrag(t), ["4567:dQw4w9WgXcQ", "12:t.B2", "88:aaaaaaaaaaa"]);
  assert.equal(readClipDrag(t), "4567:dQw4w9WgXcQ", "a target that knows one key still gets the grabbed row");
  assert.equal(isClipDrag(t), true);
});

check("one key, or none that are good, is not a multi-drag", () => {
  for (const keys of [[], ["4567:dQw4w9WgXcQ"], ["junk", "4567:dQw4w9WgXcQ"], ["4567:dQw4w9WgXcQ", "4567:dQw4w9WgXcQ"]]) {
    const t = fake();
    assert.equal(writeClipsDrag(t, keys), false, JSON.stringify(keys));
    assert.equal(t.data.size, 0);
  }
  assert.equal(readClipsDrag(null), null);
  assert.equal(readClipsDrag(fake()), null);
});

check("a list with anything malformed in it is refused whole", () => {
  for (const raw of [
    "4567:dQw4w9WgXcQ\n12:t.B2\nDROP TABLE",
    "4567:dQw4w9WgXcQ\n\n12:t.B2",
    "4567:dQw4w9WgXcQ,12:t.B2",
    "4567:dQw4w9WgXcQ\r\n12:t.B2",
  ]) {
    const t = fake();
    t.setData(CLIPS_MIME, raw);
    assert.equal(readClipsDrag(t), null, JSON.stringify(raw));
  }
});

check("a drag never carries more than a playlist can hold", () => {
  const many = Array.from({ length: CLIPS_MAX + 50 }, (_, i) => `${i + 1}:aaaaaaaaaaa`);
  const t = fake();
  assert.equal(writeClipsDrag(t, many), true);
  assert.equal(readClipsDrag(t).length, CLIPS_MAX);
  const forged = fake();
  forged.setData(CLIPS_MIME, many.join("\n"));
  assert.equal(readClipsDrag(forged), null, "a forged over-long list is refused");
});

console.log(`${ran - failed}/${ran} clip drag tests passed`);
if (failed) process.exit(1);
