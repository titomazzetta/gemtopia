import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, requestToken } from "@/lib/discogs";
import { setHandshake } from "@/lib/session";
import { CALLBACK_URL } from "@/lib/env";
import { handleError } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 + 2 of OAuth 1.0a.
 *
 * We ask Discogs for a request token, stash it (plus a random state value) in
 * a short-lived sealed cookie, then bounce the user to Discogs. The consumer
 * secret used to sign that call never leaves this function.
 */
export async function GET(request: NextRequest) {
  const limit = rateLimit(callerId(request, "auth-login"), 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many sign-in attempts." } },
      { status: 429, headers: { "retry-after": String(limit.resetSeconds) } },
    );
  }

  try {
    const { token, tokenSecret } = await requestToken(CALLBACK_URL);

    await setHandshake({ requestToken: token, requestSecret: tokenSecret });

    return NextResponse.redirect(authorizeUrl(token), { status: 302 });
  } catch (error) {
    return handleError("auth/login", error);
  }
}
