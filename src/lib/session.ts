import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { seal, unseal, randomToken } from "./crypto";
import { env } from "./env";

/**
 * Stateless, encrypted, cookie-backed sessions.
 *
 * There is no session database. The Discogs access token lives *only* inside
 * an AES-256-GCM sealed `__Host-` cookie that the browser cannot read
 * (HttpOnly) and a network attacker cannot replay onto another origin
 * (Secure + SameSite). That means:
 *   - no server-side store to breach,
 *   - no token in localStorage for XSS to exfiltrate,
 *   - revocation is the user hitting log out, or the cookie ageing out.
 */

const isProd = env.NODE_ENV === "production";

/**
 * Whether this deployment is actually served over TLS.
 *
 * This drives `Secure` and the `__Host-` prefix, and it is derived from the
 * origin rather than from NODE_ENV, because those two can disagree and the
 * browser only cares about the former.
 *
 * The previous version hardcoded `secure: true` with a comment claiming
 * "localhost counts as a secure context in modern browsers". That conflates two
 * different things. `http://localhost` *is* a secure context for JavaScript
 * APIs — service workers, WebCrypto, getUserMedia. Whether a browser will
 * *store a Secure cookie* sent over plain HTTP to localhost is a separate
 * decision, and browsers do not agree on it: Chrome and Firefox allow it,
 * Safari does not. On Safari the cookie was silently discarded — no error, no
 * warning — so the OAuth callback found no handshake and reported the sign-in
 * link as expired. A cookie you cannot set is indistinguishable from a cookie
 * that timed out, which is what made it confusing.
 */
const isHttps = env.APP_ORIGIN.startsWith("https://");

/*
 * Refuse to run a real deployment without TLS rather than quietly shipping
 * session cookies that lack Secure. Localhost is exempt: that is development.
 */
if (isProd && !isHttps && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(env.APP_ORIGIN)) {
  throw new Error(
    `APP_ORIGIN is ${env.APP_ORIGIN} but NODE_ENV is production. ` +
      `Session cookies would be sent without Secure. Use https://.`,
  );
}

/**
 * `__Host-` locks the cookie to this exact origin, path `/`, Secure-only.
 *
 * It is tied to TLS, not to NODE_ENV: the prefix *requires* Secure, so naming a
 * cookie `__Host-` on a plain-HTTP origin makes the browser reject it outright.
 */
export const SESSION_COOKIE = isHttps ? "__Host-gt_session" : "gt_session";
export const HANDSHAKE_COOKIE = isHttps ? "__Host-gt_oauth" : "gt_oauth";
export const CSRF_COOKIE = isHttps ? "__Host-gt_csrf" : "gt_csrf";

const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const HANDSHAKE_MAX_AGE = 60 * 10; // 10 minutes to finish the OAuth dance

const baseCookie = {
  httpOnly: true,
  secure: isHttps,
  sameSite: "lax" as const,
  path: "/",
};

/* ------------------------------------------------------------------ */
/* Authenticated session                                               */
/* ------------------------------------------------------------------ */

const sessionSchema = z.object({
  /** Discogs OAuth access token. */
  t: z.string().min(1),
  /** Discogs OAuth access token secret. */
  s: z.string().min(1),
  /** Discogs username. */
  u: z.string().min(1),
  /**
   * The user's `session_version` at the moment this cookie was issued.
   *
   * Every authenticated request compares this against the stored value, so
   * bumping that value kills this cookie and every other one the user holds.
   * It is the revocation mechanism that stateless sessions otherwise lack —
   * see repo.revokeAllSessions and THREAT_MODEL.md §6.
   */
  v: z.number().int().positive(),
  /** Issued-at, epoch seconds. */
  iat: z.number().int().positive(),
});

export type Session = z.infer<typeof sessionSchema>;

export async function createSession(data: {
  token: string;
  tokenSecret: string;
  username: string;
  sessionVersion: number;
}): Promise<void> {
  const payload: Session = {
    t: data.token,
    s: data.tokenSecret,
    u: data.username,
    v: data.sessionVersion,
    iat: Math.floor(Date.now() / 1000),
  };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, seal(payload), {
    ...baseCookie,
    maxAge: SESSION_MAX_AGE,
  });

  // Double-submit CSRF token. Readable by JS (that is the point) but useless
  // to another origin, which cannot read our cookies to echo it back.
  jar.set(CSRF_COOKIE, randomToken(24), {
    ...baseCookie,
    httpOnly: false,
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * Decode and integrity-check the session cookie.
 *
 * Deliberately does *not* touch the database — it answers "is this cookie
 * ours and intact", not "is this session still live". The liveness check lives
 * in `auth.requireUser`, which folds it into a query it was making anyway.
 * Anything that calls this directly must do the same, or it is trusting a
 * cookie that may have been revoked.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  const parsed = sessionSchema.safeParse(unseal(raw));
  if (!parsed.success) return null;

  // Absolute expiry, enforced server-side and not just by cookie Max-Age.
  const age = Math.floor(Date.now() / 1000) - parsed.data.iat;
  if (age > SESSION_MAX_AGE) return null;

  return parsed.data;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  for (const name of [SESSION_COOKIE, CSRF_COOKIE, HANDSHAKE_COOKIE]) {
    jar.set(name, "", { ...baseCookie, httpOnly: name !== CSRF_COOKIE, maxAge: 0 });
  }
}

/* ------------------------------------------------------------------ */
/* OAuth handshake state (request token + CSRF state, 10 min TTL)      */
/* ------------------------------------------------------------------ */

const handshakeSchema = z.object({
  rt: z.string().min(1), // oauth_token from step 1
  rs: z.string().min(1), // oauth_token_secret from step 1
  iat: z.number().int().positive(),
});

export type Handshake = z.infer<typeof handshakeSchema>;

/**
 * The handshake cookie *is* the CSRF defence for the OAuth callback
 * (RFC 5849 §11.7): it is sealed, HttpOnly, single-use, 10-minute-lived, and
 * the callback refuses to proceed unless the `oauth_token` Discogs hands back
 * matches the one sealed inside. An attacker cannot plant a handshake in the
 * victim's browser, so they cannot bind their own Discogs account to the
 * victim's session.
 */
export async function setHandshake(data: {
  requestToken: string;
  requestSecret: string;
}): Promise<void> {
  const payload: Handshake = {
    rt: data.requestToken,
    rs: data.requestSecret,
    iat: Math.floor(Date.now() / 1000),
  };
  const jar = await cookies();
  jar.set(HANDSHAKE_COOKIE, seal(payload), {
    ...baseCookie,
    maxAge: HANDSHAKE_MAX_AGE,
  });
}

/**
 * Why this distinguishes its failures.
 *
 * It used to return `null` for everything, and the callback rendered all of it
 * as "That sign-in link timed out." But *no cookie arrived* and *a cookie
 * arrived and was too old* are completely different faults with completely
 * different fixes, and collapsing them cost real debugging time when a browser
 * silently refused to store the cookie in the first place. A missing cookie is
 * never a timeout — nothing was ever there to time out.
 */
export type HandshakeFailure = "absent" | "unreadable" | "stale";

export async function consumeHandshake(): Promise<
  { ok: true; data: Handshake } | { ok: false; reason: HandshakeFailure }
> {
  const jar = await cookies();
  const raw = jar.get(HANDSHAKE_COOKIE)?.value;

  // Single use: burn it no matter what happens next.
  jar.set(HANDSHAKE_COOKIE, "", { ...baseCookie, maxAge: 0 });

  // The browser sent nothing. Either it never stored the cookie (a Secure
  // cookie over plain HTTP, or cookies blocked), or the user is finishing a
  // handshake in a different browser or profile from the one that began it.
  if (!raw) return { ok: false, reason: "absent" };

  const parsed = handshakeSchema.safeParse(unseal(raw));
  if (!parsed.success) return { ok: false, reason: "unreadable" };

  if (Math.floor(Date.now() / 1000) - parsed.data.iat > HANDSHAKE_MAX_AGE) {
    return { ok: false, reason: "stale" };
  }

  return { ok: true, data: parsed.data };
}

/* ------------------------------------------------------------------ */
/* CSRF                                                                */
/* ------------------------------------------------------------------ */

/**
 * Double-submit verification for state-changing requests.
 * SameSite=Lax already blocks the classic cross-site form POST; this is the
 * belt to that braces, and covers same-site-but-untrusted subdomains.
 */
export async function verifyCsrf(request: Request): Promise<boolean> {
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken) return false;

  const { safeEqual } = await import("./crypto");
  return safeEqual(cookieToken, headerToken);
}
