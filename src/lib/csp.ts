/**
 * The Content-Security-Policy, built per request around a fresh nonce.
 *
 * Lives apart from proxy.ts so the policy can be tested without loading
 * Next's server runtime (scripts/test-headers.mjs).
 */

const isDev = process.env.NODE_ENV === "development";

export function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'none'"],

    // strict-dynamic: only the nonced bootstrap scripts are trusted, plus
    // anything they load themselves (that covers the YouTube IFrame API,
    // which our player injects at runtime).
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      // Older browsers ignore strict-dynamic; these are the fallbacks they use.
      "https:",
      // Next.js dev server relies on eval for HMR. Never enabled in production.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    // Tailwind ships a static stylesheet, but Next injects a few inline style
    // tags for font/critical CSS that cannot currently carry a nonce.
    // Scripts — the actual XSS vector — remain strictly nonce-gated.
    "style-src": ["'self'", "'unsafe-inline'"],

    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://i.discogs.com",
      "https://img.discogs.com",
      "https://i.ytimg.com",
    ],

    "font-src": ["'self'", "data:"],

    // The browser may only talk to our own origin. All Discogs traffic is
    // proxied server-side, so no third-party host belongs here.
    "connect-src": ["'self'", ...(isDev ? ["ws:", "wss:"] : [])],

    // The audio source. youtube-nocookie.com is the privacy-preserving domain.
    "frame-src": [
      "https://www.youtube-nocookie.com",
      "https://www.youtube.com",
    ],

    "media-src": ["'self'", "blob:"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],

    // Nobody may frame us.
    "frame-ancestors": ["'none'"],
    "base-uri": ["'none'"],
    // Forms post to us — and the invite form's POST is answered with a 303 to
    // Discogs' OAuth page. Browsers apply form-action to where a submission
    // is redirected, not just where it is sent, so that one Discogs origin
    // has to be named or the invite sign-in is silently blocked.
    "form-action": ["'self'", "https://www.discogs.com"],
    "object-src": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([key, values]) => `${key} ${values.join(" ")}`,
  );

  if (!isDev) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}
