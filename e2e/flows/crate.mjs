// The rig itself, proven: the crate syncs from the fake, a record plays through
// the stubbed player, a search answers, on a desktop and on a phone — and
// Discogs is credited beside each of them, by a link to the page the data is on.
import { Rig, actor, vis, PHONE } from "../lib/harness.mjs";

/** Every "Data provided by Discogs." on the page, as "href rel". */
const credits = (page) =>
  page.getByRole("link", { name: "Data provided by Discogs." }).evaluateAll((links) => links.map((a) => `${a.getAttribute("href")} ${a.getAttribute("rel")}`));

export default async function run() {
  const rig = await new Rig("crate").launch();
  const owner = actor("e2e_owner");

  {
    const { ctx, state } = await rig.context(owner);
    const page = await rig.page(ctx);
    await rig.open(page);
    const listed = state.calls.filter((c) => c.kind === "list");
    rig.ok("the crate syncs from the fake: collection listed, details fetched", listed.length >= 1 && state.calls.some((c) => c.kind === "details"));
    const body = (await page.textContent("body")) ?? "";
    rig.ok("the crate counts every track of every owned record", /17 of 17 tracks/.test(body) && ["Bar A Thym", "Dolphin Dreams", "Atmospheric Beats", "Lucid", "Mystery Of Love", "Antimatter"].every((t) => body.includes(t)));
    const atRest = await credits(page);
    rig.ok("the crate's last line credits Discogs, linked to your collection there", atRest.some((c) => c.startsWith("https://www.discogs.com/user/e2e_owner/collection ")), atRest.join(" | "));
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(800);
    const vid = await page.evaluate(() => window.__ytStub?.vid);
    rig.ok("tapping a track plays it through the stubbed player", vid === "jjjjjjjjjjj", String(vid));
    const playing = await credits(page);
    rig.ok("the player credits Discogs, linked to the record that is playing", playing.some((c) => /^https:\/\/www\.discogs\.com\/release\/\d+ /.test(c)), playing.join(" | "));
    await vis(page.getByRole("button", { name: /^Search/ })).click();
    const box = vis(page.getByRole("textbox", { name: /Search Discogs/ }));
    await box.fill("Larry Heard");
    await box.press("Enter");
    await page.waitForTimeout(800);
    const results = (await page.textContent("body")) ?? "";
    rig.ok("a search answers, yours first", /On your wantlist/.test(results) && /Sceneries Not Songs/.test(results) && /Heard It All/.test(results));
    const searched = await credits(page);
    rig.ok("search results credit Discogs, linked to its own search for the same words", searched.some((c) => c.startsWith("https://www.discogs.com/search/?q=Larry+Heard&type=release ")), searched.join(" | "));
    rig.ok("no credit withholds what the terms ask it to pass, or says where you came from", searched.length >= 2 && searched.every((c) => /noreferrer/.test(c) && !/nofollow/.test(c)), searched.join(" | "));
    rig.ok("no page errors", page.errors.length === 0, page.errors.join(" | "));
    await rig.shot(page, "desktop");
    await ctx.close();
  }

  {
    const { ctx } = await rig.context(owner, { viewport: PHONE });
    const page = await rig.page(ctx);
    await rig.open(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    rig.ok("phone: nothing sideways", !sideways);
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await rig.shot(page, "phone");
    await ctx.close();
  }

  return rig.done();
}
