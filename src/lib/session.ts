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

/** `__Host-` locks the cookie to this exact origin, path `/`, Secure-only. */
export const SESSION_COOKIE = isProd ? "__Host-pt_session" : "pt_session";
export const HANDSHAKE_COOKIE = isProd ? "__Host-pt_oauth" : "pt_oauth";
export const CSRF_COOKIE = isProd ? "__Host-pt_csrf" : "pt_csrf";

const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days
const HANDSHAKE_MAX_AGE = 60 * 10; // 10 minutes to finish the OAuth dance

const baseCookie = {
  httpOnly: true,
  secure: true, // localhost counts as a secure context in modern browsers
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
  /** Issued-at, epoch seconds. */
  iat: z.number().int().positive(),
});

export type Session = z.infer<typeof sessionSchema>;

export async function createSession(data: {
  token: string;
  tokenSecret: string;
  username: string;
}): Promise<void> {
  const payload: Session = {
    t: data.token,
    s: data.tokenSecret,
    u: data.username,
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

export async function consumeHandshake(): Promise<Handshake | null> {
  const jar = await cookies();
  const raw = jar.get(HANDSHAKE_COOKIE)?.value;

  // Single use: burn it no matter what happens next.
  jar.set(HANDSHAKE_COOKIE, "", { ...baseCookie, maxAge: 0 });

  const parsed = handshakeSchema.safeParse(unseal(raw));
  if (!parsed.success) return null;
  if (Math.floor(Date.now() / 1000) - parsed.data.iat > HANDSHAKE_MAX_AGE) {
    return null;
  }
  return parsed.data;
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
