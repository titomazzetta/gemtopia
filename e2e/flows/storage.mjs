// Keeping the crate on the device: the app asks the browser for you where the
// browser answers without a prompt, waits for a button where it would prompt,
// reports only what the browser said, and says nothing where it cannot tell.
import { Rig, actor, vis, PHONE } from "../lib/harness.mjs";

const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0";

/** Replace navigator.storage with one that counts what it is asked. */
async function fakeStorage(ctx, { grant = false, persisted = false, missing = false } = {}) {
  await ctx.addInitScript(
    ({ grant, persisted, missing }) => {
      const calls = { persist: 0, persisted: 0 };
      window.__storage = calls;
      let kept = persisted;
      const fake = {
        persisted: async () => {
          calls.persisted += 1;
          return kept;
        },
        persist: async () => {
          calls.persist += 1;
          if (grant) kept = true;
          return kept;
        },
      };
      Object.defineProperty(Navigator.prototype, "storage", { configurable: true, get: () => (missing ? undefined : fake) });
    },
    { grant, persisted, missing },
  );
}

const asked = (page) => page.evaluate(() => window.__storage?.persist ?? -1);

export default async function run() {
  const rig = await new Rig("storage").launch();
  const owner = actor("e2e_storage");
  const menu = (page) => page.locator("details", { has: page.locator("summary", { hasText: owner.username }) });
  const openMenu = async (page) => {
    await vis(page.locator("summary", { hasText: owner.username })).click();
    await page.waitForTimeout(300);
    return (await menu(page).innerText()).replace(/\s+/g, " ");
  };
  const keepButton = (page) => page.getByRole("button", { name: /^Keep my crate on this device/ });

  /* ---- a browser that answers by itself, and says yes ---- */
  {
    const { ctx } = await rig.context(owner);
    await fakeStorage(ctx, { grant: true });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(500);
    rig.ok("with a crate on the device, the browser is asked to keep it, once, without a tap", (await asked(page)) === 1, `persist() calls: ${await asked(page)}`);
    const text = await openMenu(page);
    rig.ok("the account menu reports the browser's yes", /Crate kept on this device/.test(text) && /agreed not to clear it/.test(text) && (await keepButton(page).count()) === 0, text);
    await rig.shot(page, "kept");
    rig.ok("kept: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---- a browser that would put a prompt in front of you ---- */
  {
    const { ctx } = await rig.context(owner, { userAgent: FIREFOX });
    await fakeStorage(ctx, { grant: true });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(500);
    rig.ok("where asking shows a prompt, nothing is asked on its own", (await asked(page)) === 0, `persist() calls: ${await asked(page)}`);
    const text = await openMenu(page);
    rig.ok("…the menu offers the button instead", /Keep my crate on this device/.test(text) && /Ask this browser not to clear it/.test(text), text);
    await vis(keepButton(page)).click();
    await page.waitForTimeout(400);
    const after = (await menu(page).innerText()).replace(/\s+/g, " ");
    rig.ok("…and pressing it is what asks", (await asked(page)) === 1 && /Crate kept on this device/.test(after), `persist() calls: ${await asked(page)} · ${after}`);
    rig.ok("prompting browser: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---- a browser that answers by itself, and says no ---- */
  {
    const { ctx } = await rig.context(owner);
    await fakeStorage(ctx, { grant: false });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(500);
    const text = await openMenu(page);
    rig.ok("a silent no is not dressed up: the menu says it can still be asked", (await asked(page)) === 1 && /Keep my crate on this device/.test(text) && !/Crate kept/.test(text), `persist() calls: ${await asked(page)} · ${text}`);
    await vis(keepButton(page)).click();
    await page.waitForTimeout(400);
    const after = (await menu(page).innerText()).replace(/\s+/g, " ");
    rig.ok("…and a no to the button says what a browser goes by", /Not yet\./.test(after) && /Home Screen/.test(after) && !/Crate kept/.test(after), after);
    await ctx.close();
  }

  /* ---- a browser that cannot say ---- */
  {
    const { ctx } = await rig.context(owner);
    await fakeStorage(ctx, { missing: true });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(500);
    const text = await openMenu(page);
    rig.ok("with no Storage API the menu claims nothing and offers nothing", !/crate/i.test(text) && /Sign out/.test(text), text);
    rig.ok("no Storage API: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---- phone ---- */
  {
    const { ctx } = await rig.context(owner, { viewport: PHONE });
    await fakeStorage(ctx, { grant: false });
    const page = await rig.page(ctx);
    await rig.open(page);
    await page.waitForTimeout(3200);
    await vis(page.locator("summary", { hasText: owner.username })).tap();
    await page.waitForTimeout(300);
    const box = await vis(keepButton(page)).boundingBox();
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    rig.ok("phone: the line is in the menu, inside the screen", box !== null && box.x >= 0 && box.x + box.width <= PHONE.width && !sideways, JSON.stringify(box));
    await rig.shot(page, "phone-menu");
    rig.ok("phone: no page errors", page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  return rig.done();
}
