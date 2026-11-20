/**
 * Asking the browser to keep the crate.
 *
 * The crate lives in IndexedDB, and what a site saves in a browser is kept
 * "best effort" by default: the browser may clear it when the device runs
 * short of space, and Safari clears script-written storage for a site that
 * has had no tap or click in seven days of browser use. A first sync of a big
 * collection takes minutes, at Discogs' sixty requests a minute, so losing the
 * crate quietly is the most expensive thing this app can lose — playlists,
 * tempos and tags are on the account and are not touched.
 *
 * `navigator.storage.persist()` is the standard way to ask for better. What
 * the answer depends on is the browser's business:
 *
 *   - Chromium and Safari decide by themselves, silently, from how the site
 *     is used (Safari names being opened from the Home Screen as one signal).
 *     Asking costs the person nothing, so it is asked for them.
 *   - Firefox puts a permission prompt in front of the person. A prompt that
 *     appears from nowhere after a sync is how a site teaches people to press
 *     Block, so there it waits for a button in the account menu.
 *
 * What a yes buys is the browser's word, not a guarantee this module can
 * check: it is reported as the browser's answer and nothing more.
 *
 * Nothing here runs at import time, and every call is wrapped: a browser with
 * no Storage API, a private window that refuses, or an insecure origin all
 * come back as "unknown" rather than as an error on somebody's screen.
 */

/** The slice of `navigator.storage` this needs; a fake in tests. */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/**
 * - `kept`: the browser says this site's storage is persistent.
 * - `not-kept`: it is best effort, and can be cleared without anyone asking.
 * - `unknown`: there is no way to tell here, so nothing is claimed or offered.
 */
export type Keeping = "kept" | "not-kept" | "unknown";

/**
 * True where `persist()` shows the person a permission prompt: Firefox on a
 * desktop or on Android. Firefox on an iPhone is WebKit underneath (its name
 * there is `FxiOS`), and decides silently like Safari.
 *
 * A user-agent test because nothing else tells the two apart: the Permissions
 * API answers "prompt" in Chromium too, where no prompt ever appears. Getting
 * this wrong is cheap in both directions — a prompt appears once, or the
 * button has to be pressed — which is the only reason sniffing is acceptable.
 */
export function asksThePerson(userAgent: string): boolean {
  return /\bFirefox\/\d/.test(userAgent);
}

/** What the browser says now. Never throws. */
export async function readKeeping(storage: StorageManagerLike | null | undefined): Promise<Keeping> {
  if (!storage || typeof storage.persisted !== "function") return "unknown";
  try {
    return (await storage.persisted()) === true ? "kept" : "not-kept";
  } catch {
    return "unknown";
  }
}

/**
 * Ask. Returns the browser's answer; never throws.
 *
 * A browser that can report but not be asked keeps whatever it reported. One
 * that refuses by throwing has still answered: it is not keeping the crate.
 */
export async function askToKeep(storage: StorageManagerLike | null | undefined): Promise<Keeping> {
  if (!storage || typeof storage.persist !== "function") return readKeeping(storage);
  try {
    return (await storage.persist()) === true ? "kept" : "not-kept";
  } catch {
    return "not-kept";
  }
}

export interface QuietResult {
  state: Keeping;
  /** Whether `persist()` was called. False where it would have shown a prompt. */
  asked: boolean;
}

/**
 * The automatic ask, made once there is a crate worth keeping.
 *
 * Asks only when the answer is not already yes and asking is silent.
 */
export async function keepQuietly(input: {
  storage: StorageManagerLike | null | undefined;
  userAgent: string;
}): Promise<QuietResult> {
  const now = await readKeeping(input.storage);
  if (now !== "not-kept") return { state: now, asked: false };
  if (asksThePerson(input.userAgent)) return { state: "not-kept", asked: false };
  if (typeof input.storage?.persist !== "function") return { state: "not-kept", asked: false };
  return { state: await askToKeep(input.storage), asked: true };
}
