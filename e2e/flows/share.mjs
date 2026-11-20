// The page a share link opens. It is the one page here made for someone with
// no account, usually on a phone, usually arriving from a message — so: a
// player a thumb can work, a counter that agrees with the heading, a card for
// the chat it was pasted into, Discogs credited where its terms ask, and still
// not one request back to Gemtopia's API.
import { Rig, actor, vis, waitToast, PHONE, DESKTOP, BASE } from "../lib/harness.mjs";

const SET = "Sunday, slowly";

export default async function run() {
  const rig = await new Rig("share").launch();
  const owner = actor("e2e_share");
  let shareUrl = null;
  /** The owner's page stays open: this session is the one that knows the link is live. */
  let ownerPage = null;

  /* ---------------- the owner: a set of three, one of them record only ---------------- */
  {
    const { ctx } = await rig.context(owner);
    const page = await rig.page(ctx);
    await rig.open(page);
    await vis(page.getByRole("button", { name: /^B1\s*Antimatter/ })).click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Shift+A");
    const picker = page.getByRole("dialog", { name: /Add to playlist/ });
    await picker.waitFor({ timeout: 5000 });
    const name = vis(picker.getByRole("textbox"));
    await name.fill(SET);
    await name.press("Enter");
    await waitToast(page, /Started/);
    await page.waitForTimeout(400);
    for (const row of [/^A\s*Can You Feel It/, /^A1\s*(record only)?\s*Atmospheric Beats/i]) {
      await vis(page.getByRole("button", { name: row })).click();
      await page.waitForTimeout(400);
      await page.keyboard.press("a");
      await waitToast(page, /Added/);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
    await vis(page.getByRole("button", { name: /^playlists/i })).click();
    const minted = page.waitForResponse((r) => /\/api\/playlists\/[^/]+\/share$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await vis(page.getByRole("button", { name: "Create a read-only share link" })).click();
    shareUrl = (await (await minted).json()).shareUrl ?? null;
    rig.ok("the owner mints a link", typeof shareUrl === "string" && /\/s\/[A-Za-z0-9_-]{43}$/.test(shareUrl), String(shareUrl));
    ownerPage = page;
  }
  if (!shareUrl) return rig.done();
  const path = new URL(shareUrl).pathname;

  /* ---------------- a visitor: no account, no cookies ---------------- */
  for (const [label, viewport] of [["desktop", DESKTOP], ["phone", PHONE]]) {
    const { ctx } = await rig.context(null, { viewport });
    const page = await rig.page(ctx);
    const api = [];
    page.on("request", (r) => { if (r.url().startsWith(`${BASE}/api/`)) api.push(r.url()); });
    const response = await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    rig.ok(`${label}: the link opens with no account`, response?.status() === 200 && (await page.getByRole("heading", { name: SET }).count()) === 1);

    const meta = (key) => page.evaluate((k) => document.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute("content") ?? null, key);
    if (label === "desktop") {
      const card = { title: await meta("og:title"), site: await meta("og:site_name"), description: await meta("og:description"), url: await meta("og:url"), image: await meta("og:image"), robots: await meta("robots") };
      rig.ok("pasted into a chat, it is a card: the set's name, its track count, its own address", card.title === SET && card.site === "Gemtopia" && /^3 tracks, /.test(card.description ?? "") && card.url === shareUrl, JSON.stringify(card));
      const picture = await page.request.get(new URL(new URL(card.image).pathname, BASE).href);
      rig.ok("…with a picture that is there to fetch", picture.status() === 200 && /^image\/png/.test(picture.headers()["content-type"] ?? ""), `${picture.status()} ${picture.headers()["content-type"]}`);
      rig.ok("…that names no track and no artist", !/Antimatter|Nate Krafft|Mr\. Fingers|Kerri/.test(JSON.stringify(card)), JSON.stringify(card));
      rig.ok("the page asks not to be indexed, and does not cancel its links' credit", /noindex/.test(card.robots ?? "") && !/nofollow/.test(card.robots ?? ""), String(card.robots));
      rig.ok("the tab is named for the set", (await page.title()) === `${SET} · a set on Gemtopia`, await page.title());
    }

    // Opening a link is not a tap on play.
    await page.waitForTimeout(600);
    rig.ok(`${label}: nothing plays until you press play`, (await page.evaluate(() => window.__ytStub?.state)) !== 1 && (await vis(page.getByRole("button", { name: "Play", exact: true })).count()) === 1, `player state ${await page.evaluate(() => window.__ytStub?.state)}`);

    // The player: thumb-sized, the size YouTube's terms ask for, nothing hanging out of the card.
    const size = async (name) => (await vis(page.getByRole("button", { name })).boundingBox()) ?? { width: 0, height: 0 };
    const prev = await size("Previous track"), play = await size(/^(Play|Pause)$/), next = await size("Next track");
    rig.ok(`${label}: skips are 40px and play is 44px`, prev.width >= 40 && prev.height >= 40 && next.width >= 40 && next.height >= 40 && play.width >= 44 && play.height >= 44, JSON.stringify({ prev, play, next }));
    const video = await page.getByText("stub video").boundingBox();
    rig.ok(`${label}: the video is at least 200 by 200`, video !== null && video.width >= 200 && video.height >= 200, JSON.stringify(video));
    const inside = await page.evaluate(() => {
      const caption = [...document.querySelectorAll("p")].find((p) => p.textContent?.trim() === "Plays straight through.");
      const card = caption?.closest(".rounded-lg");
      if (!caption || !card) return null;
      const a = caption.getBoundingClientRect(), b = card.getBoundingClientRect();
      return a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom;
    });
    rig.ok(`${label}: the caption sits inside the player`, inside === true, String(inside));

    // The counter counts what plays, and says what doesn't.
    const body = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    rig.ok(`${label}: three tracks, two clips, and the counter says so`, /3 tracks · shared/.test(await body()) && /Clip 1 of 2 · 1 record only/.test(await body()), (await body()).slice(0, 160));
    await vis(page.getByRole("button", { name: "Play", exact: true })).click();
    await page.waitForTimeout(500);
    rig.ok(`${label}: play plays`, (await vis(page.getByRole("button", { name: "Pause" })).count()) === 1 && (await page.evaluate(() => window.__ytStub?.state)) === 1);
    await vis(page.getByRole("button", { name: "Next track" })).click();
    await page.waitForTimeout(500);
    rig.ok(`${label}: next moves on`, /Clip 2 of 2/.test(await body()) && /Can You Feel It/.test(await body()));

    // Discogs, credited the way its terms ask.
    const credit = page.getByRole("link", { name: "Data provided by Discogs." });
    const rel = (await credit.first().getAttribute("rel")) ?? "";
    rig.ok(`${label}: "Data provided by Discogs." is under the list, a link, and not nofollow`, (await credit.count()) === 1 && (await credit.getAttribute("href")) === "https://www.discogs.com/" && !/nofollow/.test(rel), `${await credit.count()} · ${rel}`);
    // Both sentences: the trademark one is part of the notice Discogs' terms ask for.
    rig.ok(`${label}: the not-affiliated notice is on the page, whole`, /This application uses Discogs. API but is not affiliated with, sponsored or endorsed by Discogs\. .Discogs. is a trademark of Zink Media, LLC\./.test(await body()));
    const rows = page.getByRole("link", { name: /^Discogs ↗$/ });
    const hrefs = await rows.evaluateAll((links) => links.map((a) => `${a.getAttribute("href")} ${a.getAttribute("rel")}`));
    rig.ok(`${label}: every row links to its record on Discogs, without a referrer and without nofollow`, hrefs.length === 3 && hrefs.every((h) => /^https:\/\/www\.discogs\.com\/release\/\d+ /.test(h) && /noreferrer/.test(h) && !/nofollow/.test(h)), hrefs.join(" | "));
    if (label === "phone") {
      const link = await rows.first().boundingBox();
      rig.ok("phone: a row's Discogs link is a target the height of the row (≥44px)", link !== null && link.height >= 44, JSON.stringify(link));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      rig.ok("phone: nothing sideways", !sideways);
    }

    // Still not connected to anything.
    rig.ok(`${label}: the page made no request to Gemtopia's API and set no cookie`, api.length === 0 && (await ctx.cookies(BASE)).length === 0, `${api.join(", ")} · cookies ${(await ctx.cookies(BASE)).length}`);
    await rig.shot(page, `${label}-share`);
    rig.ok(`${label}: no page errors`, page.errors.length === 0, page.errors.join(" | "));
    await ctx.close();
  }

  /* ---------------- revoked: the page and its card forget the set ---------------- */
  {
    const revoked = ownerPage.waitForResponse((r) => /\/share$/.test(new URL(r.url()).pathname) && r.request().method() === "POST");
    await vis(ownerPage.getByRole("button", { name: "Shared by link — click to revoke" })).click();
    await revoked;
    rig.ok("owner: no page errors", ownerPage.errors.length === 0, ownerPage.errors.join(" | "));
    await ownerPage.context().close();

    const visitor = await rig.context(null);
    const dead = await rig.page(visitor.ctx);
    const response = await dead.goto(BASE + path, { waitUntil: "networkidle" });
    const html = await dead.content();
    const ogTitle = await dead.evaluate(() => document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null);
    const ogUrl = await dead.evaluate(() => document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? null);
    rig.ok("revoked: the link is dead, and neither the page nor its card names the set", response?.status() === 404 && !html.includes(SET) && ogUrl === null && (ogTitle === null || ogTitle === "A set on Gemtopia"), `${response?.status()} · og:title ${ogTitle} · og:url ${ogUrl}`);
    await visitor.ctx.close();
  }

  return rig.done();
}
