/**
 * Link card tests.
 *
 *   npm run test:share-card
 *
 * A share link pasted into a chat becomes a card, built by that chat from the
 * page's Open Graph tags, and kept there after the link is revoked. So the
 * card is a small, permanent disclosure, and these pin what is on it: the
 * set's name and its track count, an address that comes from configuration and
 * nowhere else, and a name cleaned of anything that could make it read as
 * something other than a name in somebody else's conversation.
 */
import assert from "node:assert/strict";
import { CARD_IMAGE, CARD_SITE, cardText, shareCard } from "../src/lib/shareCard.ts";

let ran = 0, failed = 0;
const check = (name, fn) => {
  ran += 1;
  try { fn(); } catch (e) { failed += 1; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

const ORIGIN = "https://gemtopia.example";
// Token-shaped, and obviously not one.
const TOKEN = "t".repeat(43);
const set = (name, tracks = 12) => ({ name, tracks });
// Built from numbers, so no invisible character ever sits in this file.
const cp = (...codes) => String.fromCodePoint(...codes);
const RLO = cp(0x202e), ZWSP = cp(0x200b), ZWJ = cp(0x200d), SHY = cp(0xad), BOM = cp(0xfeff);
const NUL = cp(0x0), BEL = cp(0x7), LSEP = cp(0x2028), LONE_HIGH = cp(0xd83d), LONE_LOW = cp(0xdc00);

assert.equal(TOKEN.length, 43);

check("a live set's card is its name, its track count, and its own address", () => {
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: set("Sunday, slowly", 12) });
  assert.equal(card.title, "Sunday, slowly");
  assert.equal(card.siteName, CARD_SITE);
  assert.equal(card.pageTitle, "Sunday, slowly · a set on Gemtopia");
  assert.equal(card.description, "12 tracks, in the order they were meant to be played. Shared from Gemtopia.");
  assert.equal(card.url, `${ORIGIN}/s/${TOKEN}`);
  assert.equal(card.image, `${ORIGIN}${CARD_IMAGE.path}`);
});

check("one track is one track, and a big set gets its comma", () => {
  assert.match(shareCard({ origin: ORIGIN, token: TOKEN, set: set("A", 1) }).description, /^1 track, /);
  assert.match(shareCard({ origin: ORIGIN, token: TOKEN, set: set("A", 1000) }).description, /^1,000 tracks, /);
  assert.match(shareCard({ origin: ORIGIN, token: TOKEN, set: set("A", 0) }).description, /^0 tracks, /);
  // A count that is not a count is not echoed.
  assert.match(shareCard({ origin: ORIGIN, token: TOKEN, set: set("A", Number.NaN) }).description, /^0 tracks, /);
  assert.match(shareCard({ origin: ORIGIN, token: TOKEN, set: set("A", -4) }).description, /^0 tracks, /);
});

check("no set — unknown, malformed or revoked — is the generic card with no address", () => {
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: null });
  assert.equal(card.title, "A set on Gemtopia");
  assert.equal(card.pageTitle, "A set on Gemtopia");
  assert.equal(card.url, null);
  assert.ok(!card.description.includes(TOKEN));
  assert.equal(card.image, `${ORIGIN}${CARD_IMAGE.path}`);
});

check("a token that is not token-shaped never becomes an address, whatever else is true", () => {
  for (const bad of ["", "abc", "a".repeat(42), "a".repeat(44), `${"a".repeat(40)}/..`, `${"a".repeat(42)}?`, `${"a".repeat(42)} `, "../../api/playlists", `${"a".repeat(21)}%2f${"a".repeat(19)}`]) {
    const card = shareCard({ origin: ORIGIN, token: bad, set: set("Real name") });
    assert.equal(card.url, null, `"${bad}" became an address`);
    assert.equal(card.title, "A set on Gemtopia", `"${bad}" got a named card`);
  }
});

check("the address is the configured origin and the token, and nothing else", () => {
  for (const origin of ["https://gemtopia.vercel.app", "http://localhost:3000"]) {
    const card = shareCard({ origin, token: TOKEN, set: set("A") });
    assert.equal(card.url, `${origin}/s/${TOKEN}`);
    assert.equal(new URL(card.url).origin, origin);
    assert.equal(new URL(card.image).origin, origin);
  }
});

check("the card carries no track, artist or person: only the fields it was given", () => {
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: { name: "B2B", tracks: 3, owner: "tito", items: [{ title: "Antimatter", artist: "Nate Krafft" }] } });
  const all = JSON.stringify(card);
  for (const leak of ["tito", "Antimatter", "Nate Krafft"]) assert.ok(!all.includes(leak), `${leak} is on the card`);
});

check("a direction override, zero-width characters and soft hyphens are taken out of the name", () => {
  const sneaky = `Free${ZWSP} tickets${RLO} gpj.exe${ZWJ}${SHY}${BOM}`;
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: set(sneaky) });
  assert.equal(card.title, "Free tickets gpj.exe");
  for (const hidden of [RLO, ZWSP, ZWJ, SHY, BOM]) assert.ok(!card.title.includes(hidden) && !card.pageTitle.includes(hidden));
});

check("control characters go, and anything that broke a line becomes one space", () => {
  assert.equal(cardText(`Side A\n\n\tSide B${LSEP}Side C\r\nSide D`, 80), "Side A Side B Side C Side D");
  assert.equal(cardText(`be${NUL}ep${BEL}`, 80), "beep");
  assert.equal(cardText("   lots   of    room   ", 80), "lots of room");
});

check("half a surrogate pair is dropped, and a whole emoji survives", () => {
  assert.equal(cardText(`deep${LONE_HIGH} cuts${LONE_LOW}`, 80), "deep cuts");
  const disc = cp(0x1f4bf);
  assert.equal(cardText(`${disc} night`, 80), `${disc} night`);
});

check("a long name is cut on a character, never through one, and says it was cut", () => {
  const disc = cp(0x1f4bf);
  const long = disc.repeat(200);
  const cut = cardText(long, 80);
  assert.equal([...cut].length, 80);
  assert.ok(cut.endsWith("…"));
  assert.equal([...cut].slice(0, 79).join(""), disc.repeat(79));
  // Exactly at the limit is left alone.
  assert.equal(cardText("x".repeat(80), 80), "x".repeat(80));
  assert.equal(cardText("x".repeat(81), 80), `${"x".repeat(79)}…`);
});

check("a name that is nothing once cleaned gets the generic card", () => {
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: set(`${ZWSP}${RLO} \n`) });
  assert.equal(card.title, "A set on Gemtopia");
  assert.equal(card.url, null);
});

check("markup in a name stays text: escaping is the page's job, not a reason to mangle the name", () => {
  const card = shareCard({ origin: ORIGIN, token: TOKEN, set: set('<b>"Acid" & after</b>') });
  assert.equal(card.title, '<b>"Acid" & after</b>');
});

check("the picture is one static file, big enough for every chat that asked for a size", () => {
  assert.equal(CARD_IMAGE.path, "/og-set.png");
  assert.ok(CARD_IMAGE.width >= 900, "Messages asks for at least 900px wide");
  assert.ok(CARD_IMAGE.width / CARD_IMAGE.height <= 4, "WhatsApp asks for 4:1 or squarer");
});

console.log(`${ran - failed}/${ran} link card tests passed`);
if (failed) process.exit(1);
