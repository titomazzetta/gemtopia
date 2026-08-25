import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request Content-Security-Policy with a fresh script nonce.
 *
 * Next.js reads the CSP off the *request* headers and automatically stamps the
 * nonce onto every framework <script> it emits, so `strict-dynamic` is enough
 * to cover the whole app without a single `unsafe-inline` script source.
 *
 * (This is the file Next 15 called `middleware.ts`; Next 16 renamed the
 * convention to `proxy.ts`. Same edge hook, same guarantees.)
 */

const isDev = process.env.NODE_ENV === "development";

function buildCsp(nonce: string): string {
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
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };

  const parts = Object.entries(directives).map(
    ([key, values]) => `${key} ${values.join(" ")}`,
  );

  if (!isDev) parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

export default function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and the favicon.
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
