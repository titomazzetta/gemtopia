// Your Discogs folders as a filter: "only" and "hide", the shuffle that
// honours it, the choice that survives a reload, a wantlist that is never
// emptied by it, a double filed in two folders across two pages of the
// listing, and a folder that was renamed since the choice was made.
import { Rig, actor, vis, PHONE } from "../lib/harness.mjs";

const LISTENING_CLIPS = new Set(["fffffffffff", "ggggggggggg"]);

export default async function run() {
  const rig = await new Rig("folders").launch();
  const owner = actor("e2e_folders");

  {
    // Four rows a page, so the listing pages and the double's two copies
    // (one in DJ, one in Uncategorized) arrive on different pages.
    const { ctx, state } = await rig.context(owner, { fake: { pageSize: 4 } });
    const page = await rig.page(ctx);
    await rig.open(page);
    const group = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    await group.getByRole("button", { name: /^DJ\s*3$/ }).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    rig.ok("the listing came in pages", state.calls.some((c) => c.kind === "list" && c.source === "collection" && c.page === 2));
    rig.ok("the folder list was read once", state.calls.filter((c) => c.kind === "folders").length === 1);

    const chips = (await group.textContent().catch(() => "")) ?? "";
    rig.ok("the Filters rail has a Folder group with your folders and their track counts, and no 'All'", (await group.count()) === 1 && /Uncategorized\s*14/.test(chips) && /Listening\s*3/.test(chips) && !/\bAll\b/.test(chips), chips.slice(0, 120));
    rig.ok("a double with a copy in two folders, listed on two pages, counts in both", /Uncategorized\s*14/.test(chips) && /DJ\s*3/.test(chips), chips.slice(0, 120));
    await group.getByRole("button", { name: /^DJ/ }).click();
    await page.waitForTimeout(400);
    const dj = (await page.textContent("body")) ?? "";
    rig.ok("…and 'only DJ' is that record alone", /3 of 17 tracks/.test(dj) && /Antimatter/.test(dj) && !/Bar A Thym/.test(dj));
    // Hide DJ: the double's other copy is in Uncategorized, so it stays.
    await group.getByRole("group", { name: "Folder mode" }).getByRole("button", { name: "hide" }).click();
    await page.waitForTimeout(300);
    const djHidden = (await page.textContent("body")) ?? "";
    rig.ok("hiding a folder keeps a record whose other copy is filed elsewhere", /17 of 17 tracks/.test(djHidden) && /Antimatter/.test(djHidden) && (await page.getByRole("button", { name: "Reset" }).count()) === 1, (djHidden.match(/\d+ of \d+ tracks/) ?? ["?"])[0]);
    // Then untick it: "hide" with nothing to hide is not left behind.
    await group.getByRole("button", { name: /^DJ/ }).click();
    await page.waitForTimeout(300);
    rig.ok("unticking the last hidden folder leaves nothing to reset, and nothing stored", /17 of 17 tracks/.test((await page.textContent("body")) ?? "") && (await page.getByRole("button", { name: "Reset" }).count()) === 0 && (await page.evaluate(() => localStorage.getItem("gt_folders_v1"))) === null);

    await group.getByRole("button", { name: /^Listening/ }).click();
    await page.waitForTimeout(400);
    const only = (await page.textContent("body")) ?? "";
    rig.ok("one folder selected: 'only' it — the three tracks of the listening album", /3 of 17 tracks/.test(only) && /Illusions/.test(only) && !/Bar A Thym/.test(only));
    const mode = group.getByRole("group", { name: "Folder mode" });
    rig.ok("…with an only / hide switch beside the group, back at 'only' for the next folder", (await mode.count()) === 1 && (await mode.getByRole("button", { name: "only" }).getAttribute("aria-pressed")) === "true");

    await mode.getByRole("button", { name: "hide" }).click();
    await page.waitForTimeout(400);
    const hidden = (await page.textContent("body")) ?? "";
    rig.ok("hide: everything but the listening album", /14 of 17 tracks/.test(hidden) && !/Illusions/.test(hidden) && /Bar A Thym/.test(hidden));

    // The shuffle honours it.
    let leaked = false;
    const seen = [];
    for (let i = 0; i < 6; i += 1) {
      await vis(page.getByRole("button", { name: /^Shuffle$/ })).click();
      await page.waitForTimeout(500);
      const vid = await page.evaluate(() => window.__ytStub?.vid);
      seen.push(vid);
      if (LISTENING_CLIPS.has(vid)) leaked = true;
    }
    rig.ok("six shuffles never land on the hidden folder", !leaked && seen.every((v) => typeof v === "string"), seen.join(" "));

    // The choice is a standing one.
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await vis(page.getByText("Bar A Thym")).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const back = (await page.textContent("body")) ?? "";
    const group2 = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    rig.ok("after a reload the folder is still hidden: chip lit, hide pressed, 14 of 17", /14 of 17 tracks/.test(back) && (await group2.getByRole("button", { name: /^Listening/ }).getAttribute("aria-pressed")) === "true" && (await group2.getByRole("group", { name: "Folder mode" }).getByRole("button", { name: "hide" }).getAttribute("aria-pressed")) === "true");

    // A pivot from Dig filters the crate to one thing — and keeps the choice.
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(600);
    await page.keyboard.press("d");
    const labelChip = vis(page.locator('button[title="Filter the crate by this"]', { hasText: "Infra" }));
    await labelChip.waitFor({ timeout: 8000 }).catch(() => {});
    await labelChip.click().catch(() => {});
    await page.waitForTimeout(600);
    const pivoted = (await page.textContent("body")) ?? "";
    const groupAfterPivot = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    const keptNote = await page.evaluate(() => localStorage.getItem("gt_folders_v1"));
    rig.ok("a pivot from Dig (the label chip) filters to that label and keeps the hidden folder hidden", /3 of 17 tracks/.test(pivoted) && (await groupAfterPivot.getByRole("button", { name: /^Listening/ }).getAttribute("aria-pressed")) === "true" && (await groupAfterPivot.getByRole("group", { name: "Folder mode" }).getByRole("button", { name: "hide" }).getAttribute("aria-pressed")) === "true" && /"hide":true/.test(keptNote ?? ""), `${(pivoted.match(/\d+ of \d+ tracks/) ?? ["?"])[0]} · ${keptNote}`);
    // Back to just the folder choice for what follows.
    await vis(page.locator("section", { has: page.getByRole("heading", { name: "Label" }) }).first().getByRole("button", { name: /^Infra/ })).click();
    await page.waitForTimeout(300);

    // The wantlist is never emptied by it.
    await vis(page.getByRole("button", { name: /^wantlist$/i })).click();
    await page.waitForTimeout(1200);
    const wants = (await page.textContent("body")) ?? "";
    rig.ok("in the wantlist the filter hides nothing (a want has no folder) and the group isn't shown", /3 of 3 tracks/.test(wants) && (await page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).count()) === 0, (wants.match(/\d+ of \d+ tracks/) ?? ["?"])[0]);
    await vis(page.getByRole("button", { name: /^collection$/i })).click();
    await page.waitForTimeout(800);

    // Reset clears it, and the standing choice with it.
    await vis(page.getByRole("button", { name: "Reset" })).click();
    await page.waitForTimeout(400);
    const reset = (await page.textContent("body")) ?? "";
    const kept = await page.evaluate(() => localStorage.getItem("gt_folders_v1"));
    rig.ok("Reset puts every record back and forgets the choice", /17 of 17 tracks/.test(reset) && kept === null, `${(reset.match(/\d+ of \d+ tracks/) ?? ["?"])[0]} · stored ${kept}`);
    rig.ok("desktop: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await rig.shot(page, "desktop");
    await ctx.close();
  }

  {
    const { ctx } = await rig.context(owner, { viewport: PHONE });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(1200);
    await vis(page.getByRole("button", { name: /^filters$/i })).tap();
    await page.waitForTimeout(500);
    const group = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    const phoneChips = (await group.textContent().catch(() => "")) ?? "";
    rig.ok("phone: the Filters sheet has the Folder group — and the double, both copies on one page here, still counts in both", (await group.count()) === 1 && /Listening\s*3/.test(phoneChips) && /Uncategorized\s*14/.test(phoneChips) && /DJ\s*3/.test(phoneChips), phoneChips.slice(0, 80));
    await group.getByRole("button", { name: /^Listening/ }).tap();
    await page.waitForTimeout(300);
    const hideSwitch = group.getByRole("group", { name: "Folder mode" }).getByRole("button", { name: "hide" });
    const box = await hideSwitch.boundingBox();
    rig.ok("phone: the only / hide switch is a thumb's target, not a mouse's (≥ 28px tall, ≥ 44px wide)", Boolean(box) && box.height >= 28 && box.width >= 44, JSON.stringify(box && { w: Math.round(box.width), h: Math.round(box.height) }));
    await hideSwitch.tap();
    await page.waitForTimeout(300);
    rig.ok("phone: hide works from the sheet", /14 of 17 tracks/.test((await page.textContent("body")) ?? ""));
    const chip = group.getByRole("button", { name: /^Listening/ });
    rig.ok("phone: the hidden folder's chip is struck through, not lit as playing", (await chip.locator("span.line-through").count()) === 1 && (await chip.getAttribute("aria-pressed")) === "true");
    await rig.shot(page, "phone");
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  {
    // A crate cached by a build before folders: the first load after the
    // update reads the listing again — the listing only — and the chips are
    // there, without waiting for the next sync to come due.
    const { ctx, state } = await rig.context(actor("e2e_folders_upgrade"), { fake: { omitFolderIds: true } });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(2500);
    const folderGroup = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) });
    const before = { group: await folderGroup.count(), details: state.calls.filter((c) => c.kind === "details").length };
    state.omitFolderIds = false;
    const listsBefore = state.calls.filter((c) => c.kind === "list" && c.source === "collection").length;
    await page.reload({ waitUntil: "networkidle" }).catch(() => {});
    await folderGroup.first().getByRole("button", { name: /^Listening\s*3$/ }).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = {
      group: await folderGroup.count(),
      details: state.calls.filter((c) => c.kind === "details").length,
      lists: state.calls.filter((c) => c.kind === "list" && c.source === "collection").length - listsBefore,
    };
    rig.ok("a crate cached before folders gets them on the next load: one listing, no tracklist refetched", before.group === 0 && after.group === 1 && after.details === before.details && after.lists === 1, JSON.stringify({ before, after }));
    rig.ok("upgrade: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  {
    // A choice made before the folder was renamed on Discogs: its old name
    // selects nothing anyone can see, so it is dropped once the list is read.
    const { ctx } = await rig.context(actor("e2e_folders_renamed"));
    await ctx.addInitScript(() => {
      try {
        if (sessionStorage.getItem("e2e_seeded")) return;
        sessionStorage.setItem("e2e_seeded", "1");
        localStorage.setItem("gt_folders_v1", JSON.stringify({ v: 1, user: "e2e_folders_renamed", folders: ["Gone", "Listening"], hide: true }));
      } catch {}
    });
    const page = await rig.page(ctx);
    await rig.open(page);
    const group = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    await group.getByRole("button", { name: /^Listening/ }).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const stored = await page.evaluate(() => localStorage.getItem("gt_folders_v1"));
    rig.ok("a folder that no longer exists drops out of the standing choice; the one that does stays hidden", /14 of 17 tracks/.test((await page.textContent("body")) ?? "") && stored === JSON.stringify({ v: 1, user: "e2e_folders_renamed", folders: ["Listening"], hide: true }), `stored ${stored}`);
    rig.ok("renamed: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  {
    // Someone else's choice, left on a shared device: not applied, and gone
    // once this account has loaded.
    const { ctx } = await rig.context(actor("e2e_folders_second"));
    await ctx.addInitScript(() => {
      try {
        if (sessionStorage.getItem("e2e_seeded")) return;
        sessionStorage.setItem("e2e_seeded", "1");
        localStorage.setItem("gt_folders_v1", JSON.stringify({ v: 1, user: "e2e_folders", folders: ["Listening"], hide: true }));
      } catch {}
    });
    const page = await rig.page(ctx);
    await rig.open(page);
    const group = page.locator("section", { has: page.getByRole("heading", { name: "Folder" }) }).first();
    await group.getByRole("button", { name: /^Listening/ }).waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(600);
    const stored = await page.evaluate(() => localStorage.getItem("gt_folders_v1"));
    rig.ok("another account's folder choice is not applied, and is removed", /17 of 17 tracks/.test((await page.textContent("body")) ?? "") && (await group.getByRole("button", { name: /^Listening/ }).getAttribute("aria-pressed")) === "false" && stored === null, `stored ${stored}`);
    await ctx.close();
  }

  return rig.done();
}
