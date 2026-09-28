/**
 * Install tests — what makes Gemtopia an app you can put in your Dock.
 *
 *   npm run test:manifest
 *
 * An installable app fails quietly: a missing or wrong-sized icon doesn't
 * error, the browser just never offers "Install", and nobody notices until
 * someone asks where the button went. So the manifest is checked against the
 * files it points at, byte for byte where it matters.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest from "../src/app/manifest.ts";

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

const m = manifest();

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path) {
  const buf = readFileSync(path);
  assert.equal(buf.subarray(1, 4).toString("latin1"), "PNG", `${path} is not a PNG`);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

check("opens as its own app, at the root, scoped to the whole site", () => {
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/");
  assert.equal(m.scope, "/");
  assert.equal(m.id, "/");
});

check("named Gemtopia everywhere a launcher might show it", () => {
  assert.equal(m.name, "Gemtopia");
  assert.equal(m.short_name, "Gemtopia");
});

check("launch colours are the app's ink, not browser white", () => {
  assert.equal(m.background_color, "#050806");
  assert.equal(m.theme_color, "#050806");
});

check("has the 192 and 512 icons browsers require to offer Install", () => {
  const sizes = m.icons.filter((i) => (i.purpose ?? "any") === "any").map((i) => i.sizes);
  assert.ok(sizes.includes("192x192"), "no 192x192 icon");
  assert.ok(sizes.includes("512x512"), "no 512x512 icon");
});

check("has a maskable icon, so Android doesn't shrink the mark into a white circle", () => {
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
});

check("every icon exists, is a PNG, and is the size the manifest claims", () => {
  for (const icon of m.icons) {
    assert.ok(icon.src.startsWith("/icons/"), icon.src);
    const [w, h] = pngSize(`public${icon.src}`);
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
    assert.equal(icon.type, "image/png");
  }
});

check("the iPhone home-screen icon is 180x180", () => {
  const [w, h] = pngSize("src/app/apple-icon.png");
  assert.equal(`${w}x${h}`, "180x180");
});

check("no service worker ships — see the note in manifest.ts", () => {
  // A worker that cached pages would replay a stale CSP nonce. If one is ever
  // added, this test is where that decision has to be argued with.
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  assert.ok(!/serviceWorker\.register/.test(layout));
});

console.log(`\n${ran - failed}/${ran} manifest tests passed.`);
if (failed > 0) process.exit(1);
