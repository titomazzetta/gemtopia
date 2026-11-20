/**
 * The browser rig: a Chromium with a forged session, the fake Discogs at the
 * browser, YouTube's iframe API replaced by a stub, and a few assertion
 * helpers. Every flow in e2e/flows uses this and nothing else.
 *
 * Needs a built app running at BASE (default http://localhost:3000) with the
 * CI placeholder environment — the same SESSION_SECRET this process has, so a
 * session sealed here is one the server accepts. See e2e/README.md.
 */
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installFakeDiscogs } from "./fake-discogs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
export const BASE = process.env.BASE ?? "http://localhost:3000";
const YT_STUB = readFileSync(join(here, "yt-stub.js"), "utf8");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // The cloud rig keeps one global Playwright with its browsers.
    const { createRequire } = await import("node:module");
    const require = createRequire("/home/claude/.npm-global/lib/node_modules/");
    return require("playwright");
  }
}

const KEY = Buffer.from(process.env.SESSION_SECRET ?? "", "base64url");
if (KEY.length !== 32) {
  console.error("SESSION_SECRET must decode to 32 bytes — source the CI environment first.");
  process.exit(2);
}

/** Seal a session the way lib/session.ts does; only possible with the secret. */
function seal(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), "utf8")), cipher.final()]);
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

/** A signed-in person, as far as the server is concerned. */
export function actor(username) {
  return {
    username,
    session: seal({ t: "token", s: "secret", u: username, v: 1, iat: Math.floor(Date.now() / 1000) }),
    csrf: `csrf-${username}-${randomBytes(6).toString("hex")}`,
  };
}

export const PHONE = { width: 393, height: 852, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
export const DESKTOP = { width: 1280, height: 800 };

export class Rig {
  constructor(name, outDir) {
    this.name = name;
    this.out = outDir ?? process.env.E2E_OUT ?? join(process.cwd(), "e2e", "out", name);
    mkdirSync(this.out, { recursive: true });
    this.failures = 0;
    this.checks = 0;
  }

  async launch() {
    const { chromium } = await loadPlaywright();
    this.browser = await chromium.launch();
    return this;
  }

  /**
   * A fresh browser context: cookies, the fake Discogs, the YouTube stub, the tour dismissed.
   * Pass `null` for `who` to be a visitor with no account: no cookies at all.
   */
  async context(who, { viewport = DESKTOP, fake = {}, welcome = true } = {}) {
    const { isMobile, hasTouch, deviceScaleFactor, ...size } = viewport;
    const ctx = await this.browser.newContext({
      viewport: size,
      isMobile: isMobile ?? false,
      hasTouch: hasTouch ?? false,
      deviceScaleFactor: deviceScaleFactor ?? 1,
      reducedMotion: "reduce",
      locale: "en-US",
    });
    if (who) {
      await ctx.addCookies([
        { name: "gt_session", value: who.session, url: BASE },
        { name: "gt_csrf", value: who.csrf, url: BASE },
      ]);
    }
    if (welcome) {
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("gt_welcome_v1", "done");
        } catch {}
      });
    }
    await ctx.route("https://www.youtube.com/iframe_api", (r) =>
      r.fulfill({ status: 200, contentType: "text/javascript", body: YT_STUB }),
    );
    const state = await installFakeDiscogs(ctx, fake);
    return { ctx, state };
  }

  /** A page with error capture; `page.errors` collects uncaught exceptions. */
  async page(ctx) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(10_000);
    page.errors = [];
    page.on("pageerror", (e) => page.errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    return page;
  }

  /** Open the app and wait for the crate to have synced from the fake. */
  async open(page, { path = "/", until = "Bar A Thym" } = {}) {
    await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    if (until) await vis(page.getByText(until)).waitFor({ timeout: 20_000 });
    await page.waitForTimeout(400);
  }

  ok(name, cond, extra = "") {
    this.checks += 1;
    console.log(`${cond ? "ok  " : "FAIL"} ${this.name}: ${name}${extra ? ` — ${extra}` : ""}`);
    if (!cond) this.failures += 1;
  }

  async shot(page, name) {
    await page.screenshot({ path: join(this.out, `${name}.png`) }).catch(() => {});
  }

  async done() {
    await this.browser?.close();
    console.log(`${this.name}: ${this.checks - this.failures}/${this.checks} checks passed`);
    return this.failures === 0;
  }
}

/** The first visible match of a locator. */
export const vis = (locator) => locator.locator("visible=true").first();

/** Everything in role=status elements, joined — toasts live there. */
export const toastText = async (page) => (await page.locator('[role="status"]').allInnerTexts()).join(" | ");

export async function waitToast(page, re, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const text = await toastText(page);
    if (re.test(text)) return text;
    await page.waitForTimeout(100);
  }
  return toastText(page);
}

/** Playlist entries (clip keys) by playlist name, straight from the API as `who`. */
export async function playlistKeys(who, name) {
  const res = await fetch(`${BASE}/api/playlists`, {
    headers: { cookie: `gt_session=${who.session}; gt_csrf=${who.csrf}`, accept: "application/json" },
  });
  const data = await res.json();
  return data.playlists.find((p) => p.name === name)?.entries.map((e) => e.clipKey) ?? null;
}
