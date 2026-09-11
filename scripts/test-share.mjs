/**
 * Share tests.
 *
 *   npm run test:share
 *
 * Two things are worth pinning here. First, that a track which cannot produce
 * a valid Discogs link produces *no* payload — a share button that sends a
 * dead link is worse than no button, because the sender only finds out after
 * someone else has opened it. Second, that backing out of the native share
 * sheet does not silently fall through to copying something the person just
 * decided not to send.
 */
import assert from "node:assert/strict";
import { buildShare, shareOrCopy } from "../src/client/share.ts";
import { isReleaseId, releaseUrl, marketplaceUrl } from "../src/lib/discogs-links.ts";

let ran = 0;
let failed = 0;

function check(name, fn) {
  ran += 1;
  try {
    const out = fn();
    if (out instanceof Promise) return out.catch((error) => {
      failed += 1;
      console.error(`FAIL  ${name}\n      ${error.message}`);
    });
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
  return Promise.resolve();
}

const track = (over = {}) => ({
  releaseId: 12345,
  title: "Kinetic",
  artist: "Golden Girls",
  ...over,
});

/* ---------------------------------- urls --------------------------------- */

const urlTests = [
  check("release url is the public page", () => {
    assert.equal(releaseUrl(12345), "https://www.discogs.com/release/12345");
  }),
  check("marketplace url points at listings", () => {
    assert.equal(marketplaceUrl(12345), "https://www.discogs.com/sell/release/12345");
  }),
  check("a real id is accepted", () => {
    assert.equal(isReleaseId(1), true);
  }),
  check("zero, negatives and fractions are not release ids", () => {
    for (const bad of [0, -1, 1.5, NaN, Infinity]) {
      assert.equal(isReleaseId(bad), false, `${bad} slipped through`);
    }
  }),
  check("non-numbers are not release ids", () => {
    for (const bad of ["1", null, undefined, {}, []]) {
      assert.equal(isReleaseId(bad), false, `${JSON.stringify(bad)} slipped through`);
    }
  }),
];

/* -------------------------------- payload -------------------------------- */

const payloadTests = [
  check("title reads artist then track", () => {
    assert.equal(buildShare(track()).title, "Golden Girls — Kinetic");
  }),
  check("the url is the discogs release page", () => {
    assert.equal(buildShare(track()).url, "https://www.discogs.com/release/12345");
  }),
  check("the link is repeated in the text, for targets that drop url", () => {
    const payload = buildShare(track());
    assert.ok(payload.text.includes(payload.url), "text carries no link");
  }),
  check("a missing artist still shares under the track name", () => {
    assert.equal(buildShare(track({ artist: "  " })).title, "Kinetic");
  }),
  check("a missing track still shares under the artist", () => {
    assert.equal(buildShare(track({ title: "" })).title, "Golden Girls");
  }),
  check("no name at all is not shareable", () => {
    assert.equal(buildShare(track({ artist: "", title: "" })), null);
  }),
  check("a bad release id is not shareable", () => {
    for (const bad of [0, -3, 1.5, NaN]) {
      assert.equal(buildShare(track({ releaseId: bad })), null, `${bad} produced a payload`);
    }
  }),
  check("surrounding whitespace never reaches the sheet", () => {
    assert.equal(buildShare(track({ artist: " Golden Girls ", title: " Kinetic " })).title, "Golden Girls — Kinetic");
  }),
];

/* -------------------------------- routing -------------------------------- */

const payload = buildShare(track());

const routingTests = [
  check("a phone gets the native sheet", async () => {
    const seen = [];
    const outcome = await shareOrCopy(payload, {
      share: async (data) => void seen.push(data),
    });
    assert.equal(outcome, "shared");
    assert.deepEqual(seen, [payload]);
  }),

  check("a desktop with no share sheet copies the url", async () => {
    const written = [];
    const outcome = await shareOrCopy(payload, {
      clipboard: { writeText: async (t) => void written.push(t) },
    });
    assert.equal(outcome, "copied");
    assert.deepEqual(written, [payload.url]);
  }),

  check("backing out of the sheet copies nothing", async () => {
    const written = [];
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const outcome = await shareOrCopy(payload, {
      share: async () => {
        throw abort;
      },
      clipboard: { writeText: async (t) => void written.push(t) },
    });
    assert.equal(outcome, "dismissed");
    assert.deepEqual(written, [], "clipboard was written after a cancel");
  }),

  check("a share that genuinely fails falls back to copying", async () => {
    const written = [];
    const outcome = await shareOrCopy(payload, {
      share: async () => {
        throw new Error("NotAllowedError");
      },
      clipboard: { writeText: async (t) => void written.push(t) },
    });
    assert.equal(outcome, "copied");
    assert.deepEqual(written, [payload.url]);
  }),

  check("canShare saying no skips straight to the clipboard", async () => {
    let shareCalled = false;
    const outcome = await shareOrCopy(payload, {
      share: async () => void (shareCalled = true),
      canShare: () => false,
      clipboard: { writeText: async () => {} },
    });
    assert.equal(outcome, "copied");
    assert.equal(shareCalled, false, "share() was called despite canShare false");
  }),

  check("neither route available is reported, not thrown", async () => {
    assert.equal(await shareOrCopy(payload, {}), "unavailable");
  }),

  check("a clipboard that rejects is reported, not thrown", async () => {
    const outcome = await shareOrCopy(payload, {
      clipboard: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    assert.equal(outcome, "unavailable");
  }),
];

/* ------------------------------------------------------------------------ */

await Promise.all([...urlTests, ...payloadTests, ...routingTests]);

if (failed > 0) {
  console.error(`\n${failed} of ${ran} share tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} share tests passed.`);
