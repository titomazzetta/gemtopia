#!/usr/bin/env node
/**
 * Draws public/og-set.png, the picture on a share link's card.
 *
 *   node scripts/make-og-card.mjs
 *
 * The picture is one static file, the same for every set: it carries the mark
 * and a line of type and nothing about any set, anyone's records or anyone's
 * sleeves (Discogs' cover images are not ours to put on a card). It lives in
 * the repository as a file; this script is how it was made, so the next
 * change to it is an edit here and a re-run, not a mystery PNG.
 *
 * Needs a Chromium for Playwright (`npx playwright install chromium`).
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "og-set.png");
const mark = readFileSync(join(root, ".github", "mark-dark.svg"), "utf8").replace(/width="72" height="72"/, 'width="168" height="168"');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background:
      radial-gradient(900px 520px at 12% 0%, rgba(94, 240, 138, 0.13), transparent 62%),
      radial-gradient(700px 420px at 100% 100%, rgba(255, 176, 0, 0.05), transparent 60%),
      #050806;
    color: #f5f5f5;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 76px 84px 70px;
  }
  .top { display: flex; align-items: center; gap: 22px; color: #a3a3a3; font-size: 30px; letter-spacing: 0.22em; text-transform: uppercase; }
  .top svg { width: 46px; height: 46px; }
  h1 { font-size: 92px; line-height: 1.04; font-weight: 650; letter-spacing: -0.025em; }
  p { margin-top: 26px; font-size: 38px; line-height: 1.3; color: #a3a3a3; max-width: 880px; text-wrap: balance; }
  .gem { position: absolute; right: 84px; top: 70px; opacity: 0.95; }
  .rule { height: 2px; width: 100%; background: linear-gradient(90deg, #2a4231, transparent 85%); margin-bottom: 26px; }
  .foot { font-size: 28px; color: #8a8a8a; }
</style></head><body>
  <div class="top">${mark.replace(/width="168" height="168"/, 'width="46" height="46"')}<span>Gemtopia</span></div>
  <div class="gem">${mark}</div>
  <div>
    <h1>A set on Gemtopia</h1>
    <p>Records in the order they were meant to be played.</p>
  </div>
  <div>
    <div class="rule"></div>
    <div class="foot">For the storytelling DJ</div>
  </div>
</body></html>`;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: out, type: "png" });
} finally {
  await browser.close();
}
console.log(`${out}: ${statSync(out).size.toLocaleString("en-US")} bytes`);
