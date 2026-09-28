import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, requestToken } from "@/lib/discogs";
import { setHandshake } from "@/lib/session";
import { CALLBACK_URL, env } from "@/lib/env";
import { handleError, originAllowed } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { inviteHash } from "@/lib/invites";
import { inviteUsable } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 + 2 of OAuth 1.0a.
 *
 * We ask Discogs for a request token, stash it (plus a random state value) in
 * a short-lived sealed cookie, then bounce the user to Discogs. The consumer
 * secret used to sign that call never leaves this function.
 *
 * Two ways in:
 *   GET  — the plain "Sign in with Discogs" link. Members and admins.
 *   POST — the invite form. Carries a code in the form body, not the URL, so
 *          it never lands in browser history, a Referer header, or a request
 *          log. The code is checked here first so a mistyped or dead one
 *          fails in a second rather than after a round trip to Discogs, and
 *          then travels to the callback sealed inside the handshake cookie.
 *
 * Whether the person may actually sign up is decided in the callback, once
 * Discogs has told us who they are. Nothing here grants access.
 */

function back(reason: string) {
  const url = new URL("/", env.APP_ORIGIN);
  url.searchParams.set("auth_error", reason);
  // 303 so a POST is followed by a GET, never re-submitted.
  return NextResponse.redirect(url, { status: 303 });
}

async function begin(inviteHash?: string) {
  const { token, tokenSecret } = await requestToken(CALLBACK_URL);
  await setHandshake({ requestToken: token, requestSecret: tokenSecret, inviteHash });
  return NextResponse.redirect(authorizeUrl(token), { status: 303 });
}

export async function GET(request: NextRequest) {
  const limit = rateLimit(callerId(request, "auth-login"), 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many sign-in attempts." } },
      { status: 429, headers: { "retry-after": String(limit.resetSeconds) } },
    );
  }

  try {
    return await begin();
  } catch (error) {
    return handleError("auth/login", error);
  }
}

export async function POST(request: NextRequest) {
  // No session exists yet, so there is no CSRF token to check. The Origin
  // check is what stops another site posting this form; SameSite does the
  // rest for the handshake cookie it sets.
  if (!originAllowed(request)) return back("invalid");

  // Tighter than sign-in itself, and counted separately: this is the only
  // place a stranger can test a code, so this is the brute-force budget.
  // Ten tries per quarter hour against ~8.5 × 10^11 codes. See invite-code.ts.
  const limit = rateLimit(callerId(request, "invite-check"), 10, 15 * 60_000);
  if (!limit.ok) return back("rate_limited");

  let hash: string | null = null;
  try {
    const form = await request.formData();
    hash = inviteHash(form.get("code"));
  } catch {
    return back("invite_invalid");
  }
  if (!hash) return back("invite_invalid");

  try {
    if (!(await inviteUsable(hash))) return back("invite_invalid");
    return await begin(hash);
  } catch (error) {
    return handleError("auth/login", error);
  }
}
