// Scan a record: photos become cards, a card's tracks play before they go
// anywhere, ticking and playing never cross, and the records and tracks go
// where you say — in the order of the photos.
//
// The reader is faked at the browser like the rest of Discogs (the fake's
// /api/scan answers with what "the model read"); headless Chromium has no
// BarcodeDetector, so every photo takes the model path. What the route does
// with a real image is test-api.mjs' and test-sleeve.mjs' job.
import { deflateSync } from "node:zlib";
import { Rig, actor, vis, waitToast, PHONE, playlistKeys } from "../lib/harness.mjs";

const PAUSED = 2;

/** A flat-colour PNG: a "photo" the browser can decode and re-encode. */
function png(width, height, [r, g, b]) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "latin1");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([r, g, b], 1 + x * 3);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const READS = [
  // The centre label of a compilation on the shelf: a catalogue number.
  { read: { barcode: null, catno: "GCR-012", label: "Grape City Records", artist: "Various", title: "Deep Cuts Volume One", year: 2001, confidence: 0.9, source: "model" }, model: "stub" },
  // The back of a record nobody here owns: its barcode.
  { read: { barcode: "0123456789012", catno: null, label: null, artist: null, title: null, year: null, confidence: 0.9, source: "model" }, model: "stub" },
];

/** The file input behind the camera button of the search box that is on screen. */
const cameraInput = (page) =>
  vis(page.getByRole("textbox", { name: /Search Discogs/ }))
    .locator("xpath=ancestor::form")
    .locator('input[type="file"]');

export default async function run() {
  const rig = await new Rig("scan").launch();
  const owner = actor("e2e_scan");

  /* ---------------- desktop ---------------- */
  {
    const { ctx, state } = await rig.context(owner, { fake: { scanAnswers: READS } });
    const page = await rig.page(ctx);
    await rig.open(page);
    await vis(page.getByRole("button", { name: /^Search/ })).click();
    await cameraInput(page).setInputFiles([
      { name: "label.png", mimeType: "image/png", buffer: png(320, 240, [40, 90, 60]) },
      { name: "back.png", mimeType: "image/png", buffer: png(240, 320, [90, 40, 60]) },
    ]);
    const sheet = page.getByRole("dialog", { name: "Scan records" });
    await sheet.getByText("2 found").waitFor({ timeout: 20_000 }).catch(() => {});
    const scans = state.calls.filter((c) => c.kind === "scan");
    rig.ok("two photos are read one after the other, each sent re-encoded as a JPEG", scans.length === 2 && scans.every((c) => c.mime === "image/jpeg" && c.bytes > 64), JSON.stringify(scans));

    const first = sheet.getByRole("listitem", { name: "Photo 1", exact: true });
    const second = sheet.getByRole("listitem", { name: "Photo 2", exact: true });
    const firstText = (await first.textContent().catch(() => "")) ?? "";
    const secondText = (await second.textContent().catch(() => "")) ?? "";
    rig.ok("each photo is a card: the record, why, and whether it's yours", /Deep Cuts Volume One/.test(firstText) && /Your copy/.test(firstText) && /GCR-012/.test(firstText) && /Mirror Dance/.test(secondText) && /Not in your collection/.test(secondText), `${firstText.slice(0, 90)} || ${secondText.slice(0, 90)}`);
    rig.ok("a card has Play the record, and every track with a clip is a play button", (await first.getByRole("button", { name: "Play the record" }).count()) === 1 && (await first.getByRole("button", { name: /^Play: / }).count()) === 3);
    rig.ok("a track with no clip is a plain row, marked record only — still tickable", (await second.getByRole("button", { name: /^Play: A\s+Mirror Dance$/ }).count()) === 1 && (await second.getByRole("button", { name: /^Play: B/ }).count()) === 0 && /record only/.test(secondText) && (await second.getByRole("checkbox").count()) === 2);
    const a2 = first.getByRole("button", { name: "Play: A2 Dolphin Dreams" });
    rig.ok("a compilation's rows name who made each track, and a clip's runtime stands in for a missing length", /Nate Krafft/.test(firstText) && /Larry Heard/.test(firstText) && /Kerri Chandler/.test(firstText) && /5:32/.test((await a2.textContent().catch(() => "")) ?? ""), ((await a2.textContent().catch(() => "")) ?? "").slice(0, 60));

    // Hear it before it goes anywhere.
    await a2.click();
    await page.waitForTimeout(700);
    const playingRow = first.getByRole("button", { name: "Pause: A2 Dolphin Dreams" });
    const vid1 = await page.evaluate(() => window.__ytStub?.vid);
    rig.ok("tapping a track plays it: the row says playing, the card offers Pause, the sheet stays open", vid1 === "ddddddddddd" && (await playingRow.count()) === 1 && /playing/.test((await playingRow.textContent()) ?? "") && (await first.getByRole("button", { name: "Pause", exact: true }).count()) === 1 && (await sheet.count()) === 1, String(vid1));
    rig.ok("…as a detour: Back to shuffle is waiting in the player underneath", (await page.getByText("Back to shuffle").count()) >= 1);
    const ticks = await first.getByRole("checkbox").evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-checked")));
    rig.ok("playing didn't touch the ticks", ticks.length === 3 && ticks.every((t) => t === "true"), ticks.join(","));

    await playingRow.click();
    await page.waitForTimeout(400);
    const pausedRow = first.getByRole("button", { name: "Resume: A2 Dolphin Dreams" });
    const stubState = await page.evaluate(() => window.__ytStub?.state);
    rig.ok("a second tap pauses: the row says paused, the card offers Resume", (await pausedRow.count()) === 1 && /paused/.test((await pausedRow.textContent()) ?? "") && (await first.getByRole("button", { name: "Resume", exact: true }).count()) === 1 && stubState === PAUSED, `state ${stubState}`);

    await first.getByRole("button", { name: "Play: B1 Shiva (Compilation Edit)" }).click();
    await page.waitForTimeout(700);
    const vid2 = await page.evaluate(() => window.__ytStub?.vid);
    rig.ok("another track plays from there, and the first is a plain play button again", vid2 === "eeeeeeeeeee" && (await first.getByRole("button", { name: "Play: A2 Dolphin Dreams" }).count()) === 1, String(vid2));

    // The records themselves, to the wantlist and the collection: the sheet
    // stays open, and your own copy is never offered.
    const target = sheet.getByRole("group", { name: "Add these to" });
    await target.getByRole("button", { name: "Wantlist" }).click();
    await sheet.getByRole("button", { name: "Add 1 record to your wantlist" }).click();
    await sheet.getByText("Added 1 record to your wantlist").waitFor({ timeout: 5000 }).catch(() => {});
    await target.getByRole("button", { name: "Collection" }).click();
    await sheet.getByRole("button", { name: "Add 1 record to your collection" }).click();
    await sheet.getByText("Added 1 record to your collection").waitFor({ timeout: 5000 }).catch(() => {});
    const wanted = state.calls.filter((c) => c.kind === "want").map((c) => c.releaseId);
    const collected = state.calls.filter((c) => c.kind === "collect").map((c) => c.releaseId);
    rig.ok("the stranger goes on the wantlist, then into the collection; your own copy is never offered", wanted.join() === "990001" && collected.join() === "990001" && (await sheet.getByRole("button", { name: "All of these are in your collection" }).count()) === 1 && /Added to your collection/.test((await second.textContent().catch(() => "")) ?? ""), JSON.stringify({ wanted, collected }));

    // Untick what stays on the shelf; the rest goes into a set in photo order.
    await first.getByRole("checkbox", { name: "A1 Mirror" }).click();
    await target.getByRole("button", { name: "Playlist" }).click();
    const addTracks = sheet.getByRole("button", { name: /^Add 4 tracks to/ });
    rig.ok("unticking one leaves four tracks to add, record-only ones included", (await addTracks.count()) === 1 && (await first.getByRole("checkbox", { name: "A1 Mirror" }).getAttribute("aria-checked")) === "false");
    const setName = `Scanned ${Date.now()}`;
    await addTracks.click();
    const picker = page.getByRole("dialog", { name: /Add to playlist/ });
    await picker.waitFor({ timeout: 5000 }).catch(() => {});
    const newName = vis(picker.getByRole("textbox"));
    await newName.fill(setName);
    await newName.press("Enter");
    await waitToast(page, /Added|Scanned/);
    await page.waitForTimeout(600);
    const keys = await playlistKeys(owner, setName);
    rig.ok("the ticked tracks are in the set, in the order of the photos", Array.isArray(keys) && keys.length === 4 && keys[0] === "102:ddddddddddd" && keys[1] === "102:eeeeeeeeeee" && keys[2] === "990001:mmmmmmmmmmm" && /^990001:t\./.test(keys[3] ?? ""), JSON.stringify(keys));
    rig.ok("…and the sheet is done: it closes once the tracks are in", (await page.getByRole("dialog", { name: "Scan records" }).count()) === 0);
    await rig.shot(page, "desktop");
    rig.ok("desktop: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------------- phone ---------------- */
  {
    const { ctx } = await rig.context(owner, { viewport: PHONE, fake: { scanAnswers: [READS[0]] } });
    const page = await rig.page(ctx);
    await rig.open(page);
    await vis(page.getByRole("button", { name: /Search Discogs and add a record/ })).tap();
    await cameraInput(page).setInputFiles([{ name: "label.png", mimeType: "image/png", buffer: png(320, 240, [40, 90, 60]) }]);
    const sheet = page.getByRole("dialog", { name: "Scan records" });
    await sheet.getByText("1 found").waitFor({ timeout: 20_000 }).catch(() => {});
    const card = sheet.getByRole("listitem", { name: "Photo 1", exact: true });
    const tick = await card.getByRole("checkbox", { name: "A1 Mirror" }).boundingBox();
    const title = await card.getByRole("button", { name: "Play: A1 Mirror" }).boundingBox();
    rig.ok("phone: the tick box is its own 44px target beside the title", Boolean(tick && title) && tick.width >= 44 && tick.height >= 40 && tick.x + tick.width <= title.x + 1, JSON.stringify(tick && { w: Math.round(tick.width), h: Math.round(tick.height) }));
    await card.getByRole("button", { name: "Play: A1 Mirror" }).tap();
    await page.waitForTimeout(700);
    const vid = await page.evaluate(() => window.__ytStub?.vid);
    rig.ok("phone: a tap on the title plays the track, and the tick stays", vid === "ccccccccccc" && (await card.getByRole("checkbox", { name: "A1 Mirror" }).getAttribute("aria-checked")) === "true" && (await card.getByRole("button", { name: "Pause: A1 Mirror" }).count()) === 1, String(vid));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    rig.ok("phone: nothing sideways", !sideways);
    await rig.shot(page, "phone");
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  return rig.done();
}
