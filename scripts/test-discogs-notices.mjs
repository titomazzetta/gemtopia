/**
 * Discogs notice tests.
 *
 *   npm run test:notices
 *
 * Discogs' API Terms of Use ask an application for two notices, in their
 * wording: one saying it uses their API and is not affiliated with them, shown
 * prominently; and "Data provided by Discogs." directly next to their data,
 * linked to the Discogs page the data is on, by a link that passes
 * search-engine credit.
 *
 * Nothing breaks when a notice goes missing, which is exactly why this exists:
 * a screen redesign can drop a line of small print and every other suite stays
 * green. These read the source and fail when a screen that shows Discogs data
 * has lost its credit, when the wording drifts, or when a link starts
 * withholding the credit the terms ask it to pass.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DISCOGS_AFFILIATION_NOTICE, DISCOGS_DATA_NOTICE } from "../src/lib/discogsNotices.ts";
import { DISCOGS_HOME, collectionUrl, releaseUrl, searchUrl, wantlistUrl } from "../src/lib/discogs-links.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const walk = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

const sources = walk("src").filter((path) => /\.(ts|tsx)$/.test(path));

check("the two notices are Discogs' words, to the letter", () => {
  // Their page sets the apostrophe and the quotation marks typographically.
  // Built from numbers here, so a straight quote cannot slip in unnoticed.
  const APOSTROPHE = String.fromCodePoint(0x2019);
  const OPEN = String.fromCodePoint(0x2018), CLOSE = String.fromCodePoint(0x2019);
  assert.equal(
    DISCOGS_AFFILIATION_NOTICE,
    `This application uses Discogs${APOSTROPHE} API but is not affiliated with, sponsored or endorsed by Discogs. ` +
      `${OPEN}Discogs${CLOSE} is a trademark of Zink Media, LLC.`,
  );
  assert.equal(DISCOGS_DATA_NOTICE, "Data provided by Discogs.");
});

check("the first notice is whole: the trademark sentence is part of what the terms ask for", () => {
  assert.match(DISCOGS_AFFILIATION_NOTICE, /is a trademark of Zink Media, LLC\.$/);
  assert.equal(DISCOGS_AFFILIATION_NOTICE.split(". ").length, 2, "the notice is two sentences");
});

check("the wording is written down once", () => {
  for (const path of sources) {
    if (path === join("src", "lib", "discogsNotices.ts")) continue;
    const text = read(path);
    assert.ok(!text.includes(DISCOGS_DATA_NOTICE), `${path} spells out the data notice instead of using the shared one`);
    assert.ok(!text.includes("is not affiliated with, sponsored or endorsed by"), `${path} spells out the affiliation notice`);
    assert.ok(!text.includes("is a trademark of Zink Media"), `${path} spells out the trademark sentence`);
  }
});

check("the not-affiliated notice is on the front door, in Help and on every shared set", () => {
  for (const path of ["src/components/SignIn.tsx", "src/components/HelpPanel.tsx", "src/app/s/[token]/page.tsx"]) {
    assert.match(read(path), /<DiscogsDisclaimer\b/, `${path} has lost the notice`);
  }
  // And on the repository's own front page, spelled out, since that is public-facing too.
  assert.ok(read("README.md").replace(/\s+/g, " ").includes(DISCOGS_AFFILIATION_NOTICE), "README.md has lost the notice");
});

/** Every screen that puts Discogs data in front of someone, and why it is on the list. */
const SCREENS = [
  ["src/components/NowPlaying.tsx", "the desktop player: the record that is playing"],
  ["src/components/CrateApp.tsx", "the crate and a set (the list's last line), and the phone's player sheet"],
  ["src/components/DigDrawer.tsx", "Dig: a record's chips and the records it leads to"],
  ["src/components/DiscogsSearch.tsx", "search results"],
  ["src/components/ScanSheet.tsx", "scan cards"],
  ["src/components/RecordOnlyCard.tsx", "a record-only track's card"],
  ["src/components/PullList.tsx", "the whole list"],
  ["src/components/InsightsPanel.tsx", "Insights: records from Discogs' graph"],
  ["src/components/HelpPanel.tsx", "How it works"],
  ["src/app/s/[token]/page.tsx", "a shared set"],
];

check("every screen that shows Discogs data carries the credit", () => {
  for (const [path, what] of SCREENS) {
    assert.match(read(path), /<DiscogsCredit\b/, `${path} (${what}) shows Discogs data without "${DISCOGS_DATA_NOTICE}"`);
  }
});

check("where one Discogs page holds what is on screen, the credit points at that page", () => {
  // A record: the player, the phone's player sheet, a record-only card, Dig.
  assert.match(read("src/components/NowPlaying.tsx"), /<DiscogsCredit href=\{releaseUrl\(current\.releaseId\)\}/);
  const app = read("src/components/CrateApp.tsx");
  assert.match(app, /<DiscogsCredit href=\{releaseUrl\(current\.releaseId\)\}/);
  assert.match(read("src/components/RecordOnlyCard.tsx"), /<DiscogsCredit href=\{releaseUrl\(item\.releaseId\)\}/);
  assert.match(read("src/components/DigDrawer.tsx"), /<DiscogsCredit href=\{[^}]*releaseUrl\(seed\.releaseId\)/);
  // Your crate: your collection, or your wantlist.
  assert.match(app, /collectionUrl\(username\)/);
  assert.match(app, /wantlistUrl\(username\)/);
  // Search results: Discogs' own search for the words that produced them.
  assert.match(read("src/components/DiscogsSearch.tsx"), /<DiscogsCredit href=\{[^}]*searchUrl\(searched\)/);
});

check("the pages those credits point at are Discogs', and nothing typed can bend the link", () => {
  assert.equal(DISCOGS_HOME, "https://www.discogs.com/");
  assert.equal(releaseUrl(42), "https://www.discogs.com/release/42");
  assert.equal(collectionUrl("some.dj"), "https://www.discogs.com/user/some.dj/collection");
  assert.equal(wantlistUrl("some.dj"), "https://www.discogs.com/wantlist?user=some.dj");
  assert.equal(searchUrl("  acid tracks "), "https://www.discogs.com/search/?q=acid+tracks&type=release");
  // A username or a search builds a link, so it is encoded: it cannot leave
  // the path it was put in, add a parameter, or change the host.
  assert.equal(collectionUrl("a b/../c?d"), "https://www.discogs.com/user/a%20b%2F..%2Fc%3Fd/collection");
  for (const hostile of ["x&type=artist", "x#frag", "x&user=other", "https://evil.example/?q=", "//evil.example", "a\\b"]) {
    for (const url of [searchUrl(hostile), wantlistUrl(hostile), collectionUrl(hostile)]) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://www.discogs.com", `${hostile} moved the link to ${parsed.origin}`);
      assert.equal(parsed.hash, "", `${hostile} added a fragment`);
    }
    const search = new URL(searchUrl(hostile));
    assert.deepEqual([...search.searchParams.keys()], ["q", "type"], `${hostile} added a parameter`);
    assert.equal(search.searchParams.get("q"), hostile);
    assert.equal(search.searchParams.get("type"), "release");
    assert.equal(search.pathname, "/search/");
    const wants = new URL(wantlistUrl(hostile));
    assert.deepEqual([...wants.searchParams.keys()], ["user"], `${hostile} added a parameter`);
    assert.equal(wants.pathname, "/wantlist");
  }
});

check("the credit is a real link, and never nofollow", () => {
  const credit = read("src/components/DiscogsCredit.tsx");
  assert.match(credit, /<a\s[^>]*href=\{href\}/s, "the credit is no longer a link");
  const rel = credit.match(/rel="([^"]*)"/)?.[1] ?? "";
  assert.ok(!/nofollow/.test(rel), `the credit's rel is "${rel}"`);
  assert.match(rel, /noreferrer/, "the credit should not tell Discogs which page you were on");
  // No link anywhere in the app withholds credit from the site it points at.
  for (const path of sources) {
    for (const [, value] of read(path).matchAll(/rel=["'{`]+([^"'`}]*)/g)) {
      assert.ok(!/nofollow/.test(value), `${path} has a rel="${value}" link`);
    }
  }
});

check("a shared set asks not to be indexed without cancelling its links' credit", () => {
  const robots = read("src/app/s/[token]/page.tsx").match(/robots:\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.match(robots, /index:\s*false/, "a share link must never be indexed");
  assert.match(robots, /follow:\s*true/, "a page-wide nofollow would cancel every Discogs link on it");
  assert.match(robots, /nocache:\s*true/);
});

console.log(`${ran - failed}/${ran} Discogs notice tests passed`);
if (failed) process.exit(1);
