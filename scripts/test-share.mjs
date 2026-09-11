/**
 * Share tests.
 *
 *   npm run test:share
 *
 * Four things are worth pinning here.
 *
 * That a track which cannot produce a valid Discogs link produces *no*
 * payload — a share button that sends a dead link is worse than no button,
 * because the sender only finds out after someone else has opened it.
 *
 * That backing out of the native share sheet does not silently fall through
 * to copying something the person just decided not to send.
 *
 * That **only a URL** crosses to the platform. The first version also passed
 * a title and a text repeating the link, and targets honouring both rendered
 * it twice. The original 20 tests all passed while that was broken, because
 * they asserted the payload contained what I meant it to contain — never what
 * a person would actually receive.
 *
 * And that a title already carrying the artist is not prefixed with it again.
 */
import assert from "node:assert/strict";
import { buildShare, displayLabel, shareOrCopy } from "../src/client/share.ts";
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
  check("label reads artist then track", () => {
    assert.equal(buildShare(track()).label, "Golden Girls — Kinetic");
  }),
  check("the url is the discogs release page", () => {
    assert.equal(buildShare(track()).url, "https://www.discogs.com/release/12345");
  }),
  check("the payload carries nothing but a label and a url", () => {
    assert.deepEqual(Object.keys(buildShare(track())).sort(), ["label", "url"]);
  }),
  check("a missing artist still shares under the track name", () => {
    assert.equal(buildShare(track({ artist: "  " })).label, "Kinetic");
  }),
  check("a missing track still shares under the artist", () => {
    assert.equal(buildShare(track({ title: "" })).label, "Golden Girls");
  }),
  check("no name at all is not shareable", () => {
    assert.equal(buildShare(track({ artist: "", title: "" })), null);
  }),
  check("a bad release id is not shareable", () => {
    for (const bad of [0, -3, 1.5, NaN]) {
      assert.equal(buildShare(track({ releaseId: bad })), null, `${bad} produced a payload`);
    }
  }),
  check("surrounding whitespace never reaches the label", () => {
    assert.equal(
      buildShare(track({ artist: " Golden Girls ", title: " Kinetic " })).label,
      "Golden Girls — Kinetic",
    );
  }),
];

/* ------------------------------ label dedupe ----------------------------- */

const labelTests = [
  check("the reported case: artist is not repeated", () => {
    assert.equal(
      displayLabel("Halo Varga", "Halo Varga – My Sound (Future)"),
      "Halo Varga – My Sound (Future)",
    );
  }),
  check("an en dash in the uploaded title is not a reason to re-prefix", () => {
    assert.equal(displayLabel("Aphex Twin", "Aphex Twin – Xtal"), "Aphex Twin – Xtal");
  }),
  check("a plain hyphen behaves the same", () => {
    assert.equal(displayLabel("Aphex Twin", "Aphex Twin - Xtal"), "Aphex Twin - Xtal");
  }),
  check("casing is not trusted", () => {
    assert.equal(displayLabel("Halo Varga", "HALO VARGA - My Sound"), "HALO VARGA - My Sound");
  }),
  check("a title that merely mentions the artist later is still prefixed", () => {
    assert.equal(
      displayLabel("Moodymann", "Shades Of Jae (Moodymann Remix)"),
      "Moodymann — Shades Of Jae (Moodymann Remix)",
    );
  }),
  check("a different artist is prefixed normally", () => {
    assert.equal(displayLabel("Theo Parrish", "Falling Up"), "Theo Parrish — Falling Up");
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
    assert.deepEqual(seen, [{ url: payload.url }]);
  }),

  check("only a url crosses to the platform — no title, no text", async () => {
    let seen = null;
    await shareOrCopy(payload, { share: async (data) => void (seen = data) });
    assert.deepEqual(Object.keys(seen), ["url"], `also sent ${Object.keys(seen)}`);
  }),

  check("the label never leaves the app", async () => {
    let seen = null;
    await shareOrCopy(payload, { share: async (data) => void (seen = data) });
    assert.ok(
      !JSON.stringify(seen).includes(payload.label),
      "the display label was shared",
    );
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

await Promise.all([...urlTests, ...payloadTests, ...labelTests, ...routingTests]);

if (failed > 0) {
  console.error(`\n${failed} of ${ran} share tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} share tests passed.`);
