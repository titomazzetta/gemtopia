import { NextResponse, type NextRequest } from "next/server";
import { accessToken, getIdentity } from "@/lib/discogs";
import { consumeHandshake, createSession } from "@/lib/session";
import { ensureUser } from "@/lib/repo";
import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { callerId, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounce back to the app with a machine-readable reason, never a raw error. */
function back(reason?: string) {
  const url = new URL("/", env.APP_ORIGIN);
  if (reason) url.searchParams.set("auth_error", reason);
  return NextResponse.redirect(url, { status: 302 });
}

/**
 * Step 3 + 4 of OAuth 1.0a.
 *
 * Order matters here: the handshake cookie is consumed (and destroyed) before
 * anything else is trusted, and the returned `oauth_token` must match what we
 * sealed. Only then do we spend the verifier.
 */
export async function GET(request: NextRequest) {
  const limit = rateLimit(callerId(request), 20, 60_000);
  if (!limit.ok) return back("rate_limited");

  const params = request.nextUrl.searchParams;

  // The user pressed "Deny" on Discogs.
  if (params.get("denied")) return back("denied");

  const returnedToken = params.get("oauth_token");
  const verifier = params.get("oauth_verifier");

  // Single-use: this destroys the cookie regardless of outcome.
  const handshake = await consumeHandshake();

  if (!handshake) return back("expired");
  if (!returnedToken || !verifier) return back("invalid");

  // Bind the callback to the handshake this browser actually started.
  if (!safeEqual(handshake.rt, returnedToken)) return back("mismatch");

  // Verifiers are short opaque strings; anything else is not from Discogs.
  if (!/^[A-Za-z0-9]{4,64}$/.test(verifier)) return back("invalid");

  try {
    const granted = await accessToken({
      requestToken: handshake.rt,
      requestSecret: handshake.rs,
      verifier,
    });

    const username = await getIdentity({
      token: granted.token,
      tokenSecret: granted.tokenSecret,
    });

    // Seal the user's *current* session version into the cookie. Signing in
    // after a "sign out everywhere" therefore works immediately, while every
    // cookie issued before it stays dead.
    const { sessionVersion } = await ensureUser(username);

    await createSession({
      token: granted.token,
      tokenSecret: granted.tokenSecret,
      username,
      sessionVersion,
    });

    return NextResponse.redirect(new URL("/", env.APP_ORIGIN), { status: 302 });
  } catch (error) {
    console.error("[auth/callback]", error);
    return back("failed");
  }
}
