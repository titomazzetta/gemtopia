/**
 * Write-surface tests — what this app can change on a Discogs account.
 *
 *   npm run test:writes
 *
 * These read the source rather than call anything, because the claim being
 * pinned is about the code that exists, not about behaviour at runtime. The
 * sign-in page, README and SECURITY.md all make a specific promise about
 * which writes are reachable, and that promise was wrong once: it said the
 * app was add-only when removeFromWantlist had been there the whole time,
 * and it said both writes were POST when one is a PUT.
 *
 * Documentation cannot fail a build. This can.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Comments are stripped before any of this looks for code.
 *
 * Without that, this file's own first draft failed against the sentence
 * "there is deliberately no removeFromCollection" — a test that reads prose
 * as if it were code is worse than no test, because it goes green the moment
 * somebody deletes a comment.
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const discogs = stripComments(readFileSync("src/lib/discogs.ts", "utf8"));

/** Every `writeRequest("METHOD", path` call, as [method, path]. */
function writeCalls() {
  const calls = [];
  const re = /writeRequest\(\s*"([A-Z]+)"\s*,\s*\n?\s*`([^`]*)`/g;
  let match;
  while ((match = re.exec(discogs)) !== null) {
    calls.push([match[1], match[2]]);
  }
  return calls;
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

check("writeRequest is the only way to reach a Discogs write", () => {
  // If a second write helper ever appears, every assertion below stops
  // describing the whole surface — so fail loudly rather than quietly.
  const helpers = discogs.match(/^async function \w*[Ww]rite\w*\(/gm) ?? [];
  assert.equal(
    helpers.length,
    1,
    `expected one write helper, found ${helpers.length}: ${helpers.join(", ")}`,
  );
});

check("there are exactly three writes, and these are they", () => {
  const calls = writeCalls();
  assert.deepEqual(
    calls.map(([method]) => method).sort(),
    ["DELETE", "POST", "PUT"],
    "the set of HTTP methods this app can send to Discogs changed",
  );
  assert.equal(calls.length, 3);
});

check("the only DELETE this app can send addresses the wantlist", () => {
  // The load-bearing assertion. A DELETE whose path mentions `collection`
  // would mean the promise on the sign-in page is false.
  const deletes = writeCalls().filter(([method]) => method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.match(deletes[0][1], /\/wants\//);
  assert.ok(
    !/collection/.test(deletes[0][1]),
    "a DELETE can now reach a collection path",
  );
});

check("the collection is only ever written with POST", () => {
  for (const [method, path] of writeCalls()) {
    if (path.includes("collection")) {
      assert.equal(method, "POST", `collection written with ${method}`);
    }
  }
});

check("no removeFromCollection is declared or called anywhere in the source", () => {
  for (const file of sourceFiles("src")) {
    const code = stripComments(readFileSync(file, "utf8"));
    const hits = code.match(/\b(?:remove|delete)(?:From)?Collection\s*[(<]/g) ?? [];
    assert.deepEqual(
      hits,
      [],
      `${file} declares or calls a collection-removal function`,
    );
  }
});

check("every write path interpolates only the username and the release id", () => {
  // A path that interpolated anything else would mean some other part of a
  // request could steer where the write lands.
  for (const [, path] of writeCalls()) {
    const slots = path.match(/\$\{([^}]*)\}/g) ?? [];
    for (const slot of slots) {
      assert.ok(
        /encodeURIComponent\(username\)|releaseId/.test(slot),
        `write path interpolates ${slot}`,
      );
    }
  }
});

check("no call site takes its method from a variable", () => {
  // Call sites only — the declaration `async function writeRequest(method:`
  // is not one, and matching it was this test's own first bug.
  const dynamic =
    discogs.match(/(?<!function\s)\bwriteRequest\(\s*(?!")[A-Za-z_]/g) ?? [];
  assert.deepEqual(
    dynamic,
    [],
    "a write method is computed rather than written literally",
  );
});

console.log(`\n${ran - failed}/${ran} write-surface tests passed.`);
if (failed > 0) process.exit(1);
