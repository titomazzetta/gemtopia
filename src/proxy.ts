import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

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
