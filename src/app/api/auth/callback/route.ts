import { NextResponse, type NextRequest } from "next/server";
import { accessToken, getIdentity } from "@/lib/discogs";
import { consumeHandshake, createSession } from "@/lib/session";
import { ensureUser, findMember, redeemInvite } from "@/lib/repo";
import { admit } from "@/lib/invite-code";
import { INVITE_ONLY, isAdmin } from "@/lib/invites";
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
  const limit = rateLimit(callerId(request, "auth-callback"), 20, 60_000);
  if (!limit.ok) return back("rate_limited");

  const params = request.nextUrl.searchParams;

  // The user pressed "Deny" on Discogs.
  if (params.get("denied")) return back("denied");

  const returnedToken = params.get("oauth_token");
  const verifier = params.get("oauth_verifier");

  // Single-use: this destroys the cookie regardless of outcome.
  const handshake = await consumeHandshake();

  if (!handshake.ok) {
    // Distinct reasons, because "no cookie" and "old cookie" send the user to
    // two different fixes. See consumeHandshake.
    return back(
      handshake.reason === "stale"
        ? "expired"
        : handshake.reason === "absent"
          ? "no_cookie"
          : "invalid",
    );
  }
  if (!returnedToken || !verifier) return back("invalid");

  // Bind the callback to the handshake this browser actually started.
  if (!safeEqual(handshake.data.rt, returnedToken)) return back("mismatch");

  // Verifiers are short opaque strings; anything else is not from Discogs.
  if (!/^[A-Za-z0-9]{4,64}$/.test(verifier)) return back("invalid");

  try {
    const granted = await accessToken({
      requestToken: handshake.data.rt,
      requestSecret: handshake.data.rs,
      verifier,
    });

    const username = await getIdentity({
      token: granted.token,
      tokenSecret: granted.tokenSecret,
    });

    // The door. Discogs has told us who this is; now decide whether they are
    // allowed in, without creating anything until the answer is yes. The
    // policy itself is `admit`, which is pure and tested branch by branch.
    const code = handshake.data.ih;
    const admission = admit({
      member: await findMember(username),
      isAdmin: isAdmin(username),
      inviteOnly: INVITE_ONLY,
      hasCode: Boolean(code),
    });

    // Refused: no user row, no cookie. The Discogs token we were just granted
    // is dropped on the floor — it was never written anywhere.
    if (admission === "not_invited") return back("not_invited");
    if (admission === "removed") return back("removed");

    // Seal the user's *current* session version into the cookie. Signing in
    // after a "sign out everywhere" therefore works immediately, while every
    // cookie issued before it stays dead.
    let sessionVersion: number;
    if (admission === "redeem" && code) {
      // Checked at the door already, but it can have been used, revoked or
      // run out in the minutes spent on Discogs. This is the check that
      // counts: one atomic statement, see repo.redeemInvite.
      const redeemed = await redeemInvite(code, username);
      if (!redeemed) return back("invite_invalid");
      sessionVersion = redeemed.sessionVersion;
    } else {
      ({ sessionVersion } = await ensureUser(username));
    }

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
