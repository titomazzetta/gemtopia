// The rig itself, proven: the crate syncs from the fake, a record plays through
// the stubbed player, a search answers, on a desktop and on a phone.
import { Rig, actor, vis, PHONE } from "../lib/harness.mjs";

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
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(800);
    const vid = await page.evaluate(() => window.__ytStub?.vid);
    rig.ok("tapping a track plays it through the stubbed player", vid === "jjjjjjjjjjj", String(vid));
    await vis(page.getByRole("button", { name: /^Search/ })).click();
    const box = vis(page.getByRole("textbox", { name: /Search Discogs/ }));
    await box.fill("Larry Heard");
    await box.press("Enter");
    await page.waitForTimeout(800);
    const results = (await page.textContent("body")) ?? "";
    rig.ok("a search answers, yours first", /On your wantlist/.test(results) && /Sceneries Not Songs/.test(results) && /Heard It All/.test(results));
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
