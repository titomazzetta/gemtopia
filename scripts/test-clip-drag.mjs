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
import { CLIP_MIME, isClipDrag, isClipKey, readClipDrag, writeClipDrag } from "../src/client/clipDrag.ts";

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

console.log(`${ran - failed}/${ran} clip drag tests passed`);
if (failed) process.exit(1);
