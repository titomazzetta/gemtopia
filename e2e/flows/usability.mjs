// A friend's first week on an iPhone, as checks: the heart that fills, the
// artist on a compilation's rows, a length the clip knew, searching by
// artist, the way out to YouTube, thumb-sized transport, a banner that
// wraps — and picking up where you left off after the phone reloads the page.
import { Rig, actor, vis, waitToast, PHONE, playlistKeys } from "../lib/harness.mjs";

const CUED = 5;

export default async function run() {
  const rig = await new Rig("usability").launch();
  const owner = actor("e2e_usability");

  /* ---------------- desktop ---------------- */
  {
    const { ctx, state } = await rig.context(owner);
    const page = await rig.page(ctx);
    await rig.open(page);

    // Search by artist.
    await vis(page.getByRole("button", { name: /^Search/ })).click();
    const box = vis(page.getByRole("textbox", { name: /Search Discogs/ }));
    await vis(page.getByRole("button", { name: "Artist", exact: true })).click();
    rig.ok("the search box has an Artist field, with its own placeholder", /Artist name/.test((await box.getAttribute("placeholder")) ?? ""));
    await box.fill("Heard");
    await box.press("Enter");
    await page.waitForTimeout(600);
    const artistCall = state.calls.find((c) => c.kind === "search" && c.params.artist === "Heard");
    rig.ok("…and it leaves the browser as artist=, not q=", Boolean(artistCall) && !state.calls.some((c) => c.kind === "search" && c.params.q === "Heard"), JSON.stringify(state.calls.filter((c) => c.kind === "search").map((c) => c.params)));

    // The heart on a result reflects the wantlist, and toggles it.
    await vis(page.getByRole("button", { name: "All", exact: true })).click();
    await box.fill("Larry Heard");
    await box.press("Enter");
    await page.waitForTimeout(600);
    const wantedHeart = page.getByRole("button", { name: /Remove Sceneries Not Songs, Volume One from your wantlist/ });
    rig.ok("a record on your wantlist shows a filled heart, pressed", (await wantedHeart.count()) === 1 && (await wantedHeart.getAttribute("aria-pressed")) === "true");
    const strangerHeart = page.getByRole("button", { name: /Add Heard It All to your wantlist/ });
    rig.ok("a stranger's heart is empty, with Add in its name", (await strangerHeart.count()) === 1 && (await strangerHeart.getAttribute("aria-pressed")) === "false");
    rig.ok("a record you own has no heart", (await page.getByRole("button", { name: /Deep Cuts Volume One (to|from) your wantlist/ }).count()) === 0);
    await strangerHeart.click();
    await page.getByRole("button", { name: /Remove Heard It All from your wantlist/ }).waitFor({ timeout: 5000 });
    rig.ok("pressing it adds the record, and the heart fills", state.calls.some((c) => c.kind === "want" && c.releaseId === 990002));
    await page.getByRole("button", { name: /Remove Heard It All from your wantlist/ }).click();
    await page.getByRole("button", { name: /Add Heard It All to your wantlist/ }).waitFor({ timeout: 5000 });
    rig.ok("pressing it again takes the record off, and the heart empties", state.calls.some((c) => c.kind === "unwant" && c.releaseId === 990002));

    // A compilation's rows say who made each track, and a length the clip knew.
    await box.fill("Deep Cuts");
    await box.press("Enter");
    await page.waitForTimeout(600);
    await vis(page.getByRole("button", { name: /Deep Cuts Volume One/ })).click();
    await page.waitForTimeout(800);
    const record = page.locator("section", { hasText: "Deep Cuts Volume One" }).first();
    const recordText = (await record.textContent()) ?? "";
    rig.ok("the record's rows name the track's own artist on a compilation", /A1\s*Mirror\s*Nate Krafft/.test(recordText) && /Dolphin Dreams\s*Larry Heard/.test(recordText), recordText.replace(/\s+/g, " ").slice(0, 200));
    rig.ok("…and a track with no printed length shows its clip's runtime", /5:32/.test(recordText), recordText.replace(/\s+/g, " ").slice(0, 200));
    await vis(page.getByRole("button", { name: /^Close search|Close$/ })).click().catch(() => {});

    // The way out to YouTube, from the desktop player.
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(800);
    const link = page.getByRole("link", { name: /Open on YouTube/ }).first();
    rig.ok("the player links to the clip on YouTube, in a new tab, without a referrer", (await link.count()) >= 1 && (await link.getAttribute("href")) === "https://www.youtube.com/watch?v=jjjjjjjjjjj" && (await link.getAttribute("target")) === "_blank" && /noopener/.test((await link.getAttribute("rel")) ?? ""), `${await link.getAttribute("href")}`);

    // Pick up where you left off: a set open, a track three seconds in, the search open.
    const addButton = vis(page.getByRole("button", { name: /^Add to .*: Antimatter|^Add to playlist/ }));
    if (await addButton.count()) {
      await addButton.click({ modifiers: ["Shift"] }).catch(() => {});
    }
    await page.keyboard.press("Escape");
    await vis(page.getByRole("button", { name: /^Search/ })).click();
    const box2 = vis(page.getByRole("textbox", { name: /Search Discogs/ }));
    await box2.fill("Larry Heard");
    await box2.press("Enter");
    await page.waitForTimeout(3200);
    const before = await page.evaluate(() => ({ t: window.__ytStub?.t, vid: window.__ytStub?.vid }));
    const searchesBefore = state.calls.filter((c) => c.kind === "search").length;
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    // The search column comes back in the middle, so the crate rows aren't on screen.
    await vis(page.getByRole("textbox", { name: /Search Discogs/ })).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const after = await page.evaluate(() => ({ t: window.__ytStub?.t, vid: window.__ytStub?.vid, state: window.__ytStub?.state }));
    rig.ok("after a reload the same clip is cued, not playing, where it was", after.vid === before.vid && after.state === CUED && after.t >= 2 && after.t <= before.t + 1, JSON.stringify({ before, after }));
    const nowPlaying = (await page.textContent("body")) ?? "";
    rig.ok("…and the player names it", /Antimatter/.test(nowPlaying));
    const searchBox = page.getByRole("textbox", { name: /Search Discogs/ });
    rig.ok("the search is back open with its last query and results, without asking Discogs again", (await vis(searchBox).count()) === 1 && (await vis(searchBox).inputValue()) === "Larry Heard" && /Sceneries Not Songs/.test(nowPlaying) && state.calls.filter((c) => c.kind === "search").length === searchesBefore, `${await vis(searchBox).inputValue().catch(() => "no box")} · searches ${state.calls.filter((c) => c.kind === "search").length} vs ${searchesBefore}`);
    const stored = await page.evaluate(() => localStorage.getItem("gt_resume_v1"));
    rig.ok("the note holds a key, a position and no names", stored !== null && /"key":"106:jjjjjjjjjjj"/.test(stored) && !/Antimatter|Nate/.test(stored), stored ?? "none");
    await rig.shot(page, "desktop-resumed");
    rig.ok("desktop: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------------- a set, on reload ---------------- */
  {
    const { ctx } = await rig.context(owner);
    const page = await rig.page(ctx);
    await rig.open(page);
    // Make a set from a track, then play from it.
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(600);
    await page.keyboard.press("Shift+A");
    const picker = page.getByRole("dialog", { name: /Add to playlist/ });
    await picker.waitFor({ timeout: 5000 });
    const newName = vis(picker.getByRole("textbox"));
    await newName.fill("Resume set");
    await newName.press("Enter");
    await waitToast(page, /Added|Resume set/);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const keys = await playlistKeys(owner, "Resume set");
    rig.ok("a set exists to come back to", Array.isArray(keys) && keys.includes("106:jjjjjjjjjjj"), JSON.stringify(keys));
    await vis(page.getByRole("button", { name: /^playlists/i })).click();
    await vis(page.getByText("Resume set")).click();
    await page.waitForTimeout(600);
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await vis(page.getByText("Bar A Thym")).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const text = (await page.textContent("body")) ?? "";
    const stub = await page.evaluate(() => ({ vid: window.__ytStub?.vid, state: window.__ytStub?.state }));
    rig.ok("the set is open again after the reload, with the track cued from it", /Resume set/.test(text) && stub.vid === "jjjjjjjjjjj" && stub.state === CUED, JSON.stringify(stub));
    await ctx.close();
  }

  /* ---------------- phone ---------------- */
  {
    const { ctx } = await rig.context(owner, { viewport: PHONE });
    const page = await rig.page(ctx);
    await rig.open(page);
    const banner = page.locator('[role="status"] p.line-clamp-2').first();
    rig.ok("the sync banner's message may wrap to a second line instead of being cut", (await page.locator('[role="status"] p.truncate').count()) === 0);
    void banner;
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).tap();
    await page.waitForTimeout(800);
    const size = async (name) => {
      const b = await vis(page.getByRole("button", { name, exact: true })).boundingBox();
      return b ? { w: Math.round(b.width), h: Math.round(b.height) } : null;
    };
    const prev = await size("Previous");
    const next = await size("Next");
    const play = await size("Pause").catch(() => null) ?? (await size("Play"));
    rig.ok("the bar's skip buttons are thumb-sized (≥40px) and play is 44px", prev && next && play && prev.w >= 40 && prev.h >= 40 && next.w >= 40 && next.h >= 40 && play.w >= 44 && play.h >= 44, JSON.stringify({ prev, next, play }));
    await vis(page.getByRole("button", { name: "Open player" })).tap();
    await page.waitForTimeout(600);
    const sheetLink = page.getByRole("link", { name: /Open on YouTube/ });
    rig.ok("the phone's player sheet has the way out to YouTube", (await sheetLink.count()) >= 1 && (await sheetLink.first().getAttribute("href")) === "https://www.youtube.com/watch?v=jjjjjjjjjjj");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    // The search sheet, mid-search, then the page reloads under you.
    await vis(page.getByRole("button", { name: /Search Discogs and add a record/ })).tap();
    const box = vis(page.getByRole("textbox", { name: /Search Discogs/ }));
    await box.fill("Mirror");
    await box.press("Enter");
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await vis(page.getByText("Bar A Thym")).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const sheetBox = page.getByRole("textbox", { name: /Search Discogs/ });
    const stub = await page.evaluate(() => ({ vid: window.__ytStub?.vid, state: window.__ytStub?.state }));
    rig.ok("phone: after the reload the search sheet is open where it was, and the track is cued", (await vis(sheetBox).count()) === 1 && (await vis(sheetBox).inputValue()) === "Mirror" && /Mirror Dance/.test((await page.textContent("body")) ?? "") && stub.vid === "jjjjjjjjjjj" && stub.state === CUED, JSON.stringify(stub));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    rig.ok("phone: nothing sideways", !sideways);
    await rig.shot(page, "phone-resumed");
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  return rig.done();
}
