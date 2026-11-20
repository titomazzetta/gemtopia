// Building a set: the set you just named is where the next A goes, and a
// track taken out by a slip of the thumb can be put back — from the message
// that says which one went, or from the set's own bar once the message is gone.
import { Rig, actor, vis, waitToast, PHONE, playlistKeys } from "../lib/harness.mjs";

const SET = "Night one";

export default async function run() {
  const rig = await new Rig("sets").launch();
  const owner = actor("e2e_sets");
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* ---------------- desktop ---------------- */
  {
    const { ctx } = await rig.context(owner);
    const page = await rig.page(ctx);
    await rig.open(page);
    const picker = page.getByRole("dialog", { name: /Add to playlist/ });
    const undo = page.getByRole("button", { name: "Undo", exact: true });

    // A new set, named in the picker, with its first track.
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Shift+A");
    await picker.waitFor({ timeout: 5000 });
    const name = vis(picker.getByRole("textbox"));
    await name.fill(SET);
    await name.press("Enter");
    const started = await waitToast(page, /Started/);
    rig.ok("naming a set in the picker starts it with the track", /Started "Night one" with Antimatter/.test(started), started);
    await page.waitForTimeout(500);

    // The next A goes straight to it: no picker, and the + buttons say where.
    await vis(page.getByRole("button", { name: /^A1\s*Mirror/ })).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("a");
    const added = await waitToast(page, /Added/);
    rig.ok("the set you just named is the current set: the next A adds without asking", (await picker.count()) === 0 && /Night one/.test(added), `${added} · pickers open: ${await picker.count()}`);
    rig.ok("…and every + names it", (await page.getByRole("button", { name: /^Add to Night one: / }).count()) > 0);
    await vis(page.getByRole("button", { name: /^A\s*Can You Feel It/ })).click();
    await page.waitForTimeout(400);
    await page.keyboard.press("a");
    await waitToast(page, /Can You Feel It/);
    await page.waitForTimeout(400);
    const built = await playlistKeys(owner, SET);
    rig.ok("three tracks in, in the order they were added", built?.length === 3, JSON.stringify(built));

    // Open the set.
    await vis(page.getByRole("button", { name: /^playlists/i })).click();
    await vis(page.getByRole("button", { name: /^Night one\s*3 tracks/ })).click();
    await page.waitForTimeout(900);

    // Take the middle one out: the message names it and offers it back.
    const binFor = (title) => vis(page.getByRole("button", { name: new RegExp(`^Remove ${title}.* from this playlist$`) }));
    await binFor("Mirror").click();
    const took = await waitToast(page, /Took/);
    rig.ok("taking a track out says which one, and offers Undo", /Took “Mirror .*” out of Night one/.test(took) && (await vis(undo).count()) === 1, took);
    const without = await playlistKeys(owner, SET);
    rig.ok("…and it is out", without?.length === 2 && same(without, [built[0], built[2]]), JSON.stringify(without));
    await vis(undo).click();
    const back = await waitToast(page, /Put/);
    await page.waitForTimeout(500);
    rig.ok("Undo puts it back where it stood", /Put 1 track back in Night one/.test(back) && same(await playlistKeys(owner, SET), built), `${back} · ${JSON.stringify(await playlistKeys(owner, SET))}`);
    rig.ok("…and the offer is gone once taken", (await vis(undo).count()) === 0);

    // The message goes after a few seconds; the offer stays on the set's bar.
    await binFor("Can You Feel It").click();
    await waitToast(page, /Took/);
    await page.waitForTimeout(7600);
    const barUndo = vis(page.getByRole("button", { name: "Undo remove" }));
    rig.ok("when the message has gone, the set's bar still offers Undo remove", (await vis(undo).count()) === 0 && (await barUndo.count()) === 1);
    await barUndo.click();
    await waitToast(page, /Put/);
    await page.waitForTimeout(500);
    rig.ok("…and it works from there", same(await playlistKeys(owner, SET), built), JSON.stringify(await playlistKeys(owner, SET)));

    // One step of undo: the last thing you took out.
    await binFor("Mirror").click();
    await waitToast(page, /Took “Mirror/);
    await page.waitForTimeout(400);
    await binFor("Can You Feel It").click();
    await waitToast(page, /Took “Can You Feel It/);
    await vis(undo).click();
    await waitToast(page, /Put/);
    await page.waitForTimeout(500);
    const oneStep = await playlistKeys(owner, SET);
    rig.ok("undo is one step: the last track out comes back, the one before stays out", same(oneStep, [built[0], built[2]]), JSON.stringify(oneStep));

    // Several at once, then back. (On a desktop the tick boxes are on the rows.)
    await vis(page.getByRole("checkbox", { name: /^Tick Antimatter/ })).click();
    await vis(page.getByRole("checkbox", { name: /^Tick Can You Feel It/ })).click();
    await vis(page.getByRole("button", { name: /^Remove 2/ })).click();
    const tookTwo = await waitToast(page, /Took 2 tracks/);
    await page.waitForTimeout(400);
    rig.ok("taking several out offers Undo too", /Took 2 tracks out of Night one/.test(tookTwo) && (await vis(undo).count()) === 1 && same(await playlistKeys(owner, SET), []), `${tookTwo} · ${JSON.stringify(await playlistKeys(owner, SET))}`);
    await vis(undo).click();
    const backTwo = await waitToast(page, /Put/);
    await page.waitForTimeout(500);
    rig.ok("…and they come back in their places", /Put 2 tracks back in Night one/.test(backTwo) && same(await playlistKeys(owner, SET), oneStep), `${backTwo} · ${JSON.stringify(await playlistKeys(owner, SET))}`);

    await rig.shot(page, "desktop-set");
    rig.ok("desktop: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------------- phone ---------------- */
  {
    const { ctx } = await rig.context(owner, { viewport: PHONE });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(3200);
    const before = await playlistKeys(owner, SET);
    await vis(page.getByRole("button", { name: /^Your collection/ })).tap();
    await page.waitForTimeout(700);
    await vis(page.getByText(SET)).tap();
    await page.waitForTimeout(1200);

    await vis(page.getByRole("button", { name: /^Remove Antimatter from this playlist$/ })).tap();
    const took = await waitToast(page, /Took/);
    const undo = vis(page.getByRole("button", { name: "Undo", exact: true }));
    const box = await undo.boundingBox();
    rig.ok("phone: the message names the track and Undo is thumb-sized (≥44px)", /Took “Antimatter” out of Night one/.test(took) && box !== null && box.height >= 44, `${took} · ${JSON.stringify(box)}`);
    await rig.shot(page, "phone-undo");
    await undo.tap();
    await waitToast(page, /Put/);
    await page.waitForTimeout(500);
    rig.ok("phone: Undo puts it back", same(await playlistKeys(owner, SET), before), JSON.stringify(await playlistKeys(owner, SET)));
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    rig.ok("phone: nothing sideways", !sideways);
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  return rig.done();
}
