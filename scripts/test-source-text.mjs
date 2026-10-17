/**
 * No hidden characters in the source.
 *
 *   npm run test:source-text
 *
 * "Trojan Source" (CVE-2021-42574): bidi overrides and zero-width characters
 * make code read differently from how it runs — a comment that seems to end
 * where it doesn't, a string that seems to be another, a check that seems to
 * be there. This app strips them from chat messages and tags; its own source
 * shouldn't carry them either.
 *
 * Every tracked text file is read, and any Unicode format character —
 * category Cf: bidi embeddings, overrides and isolates, the directional marks,
 * zero-width space and joiners, the BOM, soft hyphen, invisible operators —
 * fails the run with its file, line and code point. A test that needs one
 * spells it as an escape ("\u202E"), which is what the files here do.
 *
 * There were 27 on main when this was written, every one deliberate — chat's
 * list of characters to strip (lib/chat.ts) and the tests that feed it those
 * characters — and no less invisible for that. The first draft of tags added
 * 61 more the same way, which is how this test came to exist.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TEXT = /\.(?:[cm]?[jt]sx?|json|sql|md|ya?ml|css|html|txt|svg|example)$/;
const HIDDEN = /\p{Cf}/gu;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files;
try {
  files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
} catch {
  // Not a checkout (a tarball, say): read the tree instead.
  files = walk(".");
}

const found = [];
let read = 0;
for (const file of files) {
  if (!TEXT.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // listed by git, deleted in the working tree
  }
  read += 1;
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(HIDDEN)) {
      const code = match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0");
      found.push(`${file}:${index + 1}  U+${code}`);
    }
  });
}

if (read < 50) {
  console.error(`FAIL  only ${read} files were read — the scan isn't looking at the source`);
  process.exit(1);
}
if (found.length > 0) {
  console.error(`FAIL  hidden characters in the source — write them as escapes (\\u202E):`);
  for (const where of found) console.error(`      ${where}`);
  process.exit(1);
}
console.log(`\nNo hidden characters in ${read} source files.`);
