/**
 * Storage persistence tests.
 *
 *   npm run test:storage
 *
 * The crate is the one thing here that is slow to get back, and it lives in
 * storage a browser may clear on its own. These pin the rules for asking the
 * browser to keep it (client/storagePersistence.ts): ask for the person where
 * asking is silent, never where it would put a permission prompt in front of
 * them unasked, claim nothing where the browser cannot say, and never throw.
 *
 * `navigator.storage` is a fake throughout, which is the point of keeping the
 * rules in a module with no browser in it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { askToKeep, asksThePerson, keepQuietly, readKeeping } from "../src/client/storagePersistence.ts";

let ran = 0, failed = 0;
const pending = [];
const check = (name, fn) => {
  ran += 1;
  pending.push(
    Promise.resolve()
      .then(fn)
      .catch((e) => { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }),
  );
};

/** A browser's storage manager, with a count of what was asked of it. */
function fake({ persisted = false, grant = false, persistedThrows = false, persistThrows = false } = {}) {
  const calls = { persisted: 0, persist: 0 };
  let kept = persisted;
  return {
    calls,
    storage: {
      persisted: async () => {
        calls.persisted += 1;
        if (persistedThrows) throw new Error("SecurityError");
        return kept;
      },
      persist: async () => {
        calls.persist += 1;
        if (persistThrows) throw new Error("NotAllowedError");
        if (grant) kept = true;
        return kept;
      },
    },
  };
}

const UA = {
  chrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15",
  safariPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:145.0) Gecko/145.0 Firefox/145.0",
  // Firefox on an iPhone is WebKit: no "Firefox/" in its name, and no prompt.
  firefoxPhone: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15",
};

/* ---- which browsers put a prompt in front of the person ---- */

check("Firefox on a desktop or on Android asks the person; nothing else does", () => {
  assert.equal(asksThePerson(UA.firefox), true);
  assert.equal(asksThePerson(UA.firefoxAndroid), true);
  for (const name of ["chrome", "chromeAndroid", "edge", "safariMac", "safariPhone", "firefoxPhone"]) {
    assert.equal(asksThePerson(UA[name]), false, `${name} was taken for a browser that prompts`);
  }
  // "like Gecko" is in every WebKit and Chromium name and must not count.
  assert.equal(asksThePerson("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko)"), false);
  assert.equal(asksThePerson(""), false);
});

/* ---- reading ---- */

check("the browser's own answer is reported, as kept or not kept", async () => {
  assert.equal(await readKeeping(fake({ persisted: true }).storage), "kept");
  assert.equal(await readKeeping(fake({ persisted: false }).storage), "not-kept");
});

check("no Storage API, or one that refuses to say, is unknown — never an error and never a claim", async () => {
  assert.equal(await readKeeping(undefined), "unknown");
  assert.equal(await readKeeping(null), "unknown");
  assert.equal(await readKeeping({}), "unknown");
  assert.equal(await readKeeping({ persisted: "yes" }), "unknown");
  assert.equal(await readKeeping(fake({ persistedThrows: true }).storage), "unknown");
});

check("only a real true counts as kept", async () => {
  for (const answer of [1, "true", {}, undefined, null]) {
    assert.equal(await readKeeping({ persisted: async () => answer }), "not-kept", `${JSON.stringify(answer)} was taken for yes`);
    assert.equal(await askToKeep({ persisted: async () => false, persist: async () => answer }), "not-kept");
  }
});

/* ---- asking ---- */

check("asking returns what the browser answered", async () => {
  const yes = fake({ grant: true });
  assert.equal(await askToKeep(yes.storage), "kept");
  assert.equal(yes.calls.persist, 1);
  const no = fake({ grant: false });
  assert.equal(await askToKeep(no.storage), "not-kept");
  assert.equal(no.calls.persist, 1);
});

check("a browser that refuses by throwing has answered no; one that cannot be asked keeps what it reported", async () => {
  assert.equal(await askToKeep(fake({ persistThrows: true }).storage), "not-kept");
  assert.equal(await askToKeep({ persisted: async () => true }), "kept");
  assert.equal(await askToKeep({ persisted: async () => false }), "not-kept");
  assert.equal(await askToKeep(undefined), "unknown");
});

/* ---- the automatic ask ---- */

check("where the browser decides silently, the app asks for you, once", async () => {
  for (const name of ["chrome", "chromeAndroid", "edge", "safariMac", "safariPhone", "firefoxPhone"]) {
    const browser = fake({ grant: true });
    const result = await keepQuietly({ storage: browser.storage, userAgent: UA[name] });
    assert.deepEqual(result, { state: "kept", asked: true }, name);
    assert.equal(browser.calls.persist, 1, `${name}: persist() calls`);
  }
});

check("a silent no is reported as not kept, so the menu can offer the button", async () => {
  const browser = fake({ grant: false });
  assert.deepEqual(await keepQuietly({ storage: browser.storage, userAgent: UA.safariPhone }), { state: "not-kept", asked: true });
});

check("where asking shows a prompt, nothing is asked until the person presses the button", async () => {
  for (const name of ["firefox", "firefoxAndroid"]) {
    const browser = fake({ grant: true });
    const result = await keepQuietly({ storage: browser.storage, userAgent: UA[name] });
    assert.deepEqual(result, { state: "not-kept", asked: false }, name);
    assert.equal(browser.calls.persist, 0, `${name} was prompted unasked`);
    // The button is the same call, made because they pressed it.
    assert.equal(await askToKeep(browser.storage), "kept");
    assert.equal(browser.calls.persist, 1);
  }
});

check("already kept, or unknowable, means no ask at all", async () => {
  const kept = fake({ persisted: true });
  assert.deepEqual(await keepQuietly({ storage: kept.storage, userAgent: UA.chrome }), { state: "kept", asked: false });
  assert.equal(kept.calls.persist, 0);
  assert.deepEqual(await keepQuietly({ storage: undefined, userAgent: UA.chrome }), { state: "unknown", asked: false });
  const mute = fake({ persistedThrows: true });
  assert.deepEqual(await keepQuietly({ storage: mute.storage, userAgent: UA.chrome }), { state: "unknown", asked: false });
  assert.equal(mute.calls.persist, 0);
  // Can report, cannot be asked.
  assert.deepEqual(await keepQuietly({ storage: { persisted: async () => false }, userAgent: UA.chrome }), { state: "not-kept", asked: false });
});

check("nothing is asked of the browser when the module is loaded", () => {
  // Comments stripped first: the doc comment names the call it is about.
  const code = readFileSync(new URL("../src/client/storagePersistence.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(!/\bnavigator\b/.test(code), "the rules reach for the browser themselves; they are handed it");
  assert.ok(!/\bwindow\b|\bdocument\b|localStorage|indexedDB/.test(code));
});

check("the account menu shows the answer, and Help says where to look", () => {
  const app = readFileSync(new URL("../src/components/CrateApp.tsx", import.meta.url), "utf8");
  assert.match(app, /<KeepCrate hasCrate=\{details\.length > 0\} \/>/, "the account menu has lost its line about the crate");
  const row = readFileSync(new URL("../src/components/KeepCrate.tsx", import.meta.url), "utf8");
  assert.match(row, /keepQuietly\(/, "nothing asks on the person's behalf any more");
  assert.match(row, /askToKeep\(/, "the button no longer asks");
  const help = readFileSync(new URL("../src/components/HelpPanel.tsx", import.meta.url), "utf8");
  assert.match(help, /seven days/, "Help no longer says why a crate can disappear");
  assert.match(help, /account menu/);
});

await Promise.all(pending);
console.log(`${ran - failed}/${ran} storage persistence tests passed`);
if (failed) process.exit(1);
