import type { NextRequest } from "next/server";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { getPlaylistByShareToken } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — read a shared playlist. **The only unauthenticated data route.**
 *
 * There is no session here by design: the token is the credential. Which means
 * this route deserves more suspicion than the rest of the API, so:
 *
 *   * It is read-only. There is no POST, PUT or DELETE on this path, and the
 *     repo function it calls cannot write.
 *   * It is rate limited by IP, harder than the authenticated routes. The
 *     token space is 2^256 and unguessable, but a limit turns "impossible"
 *     into "impossible and also not worth the traffic".
 *   * A malformed token, an unknown token and a revoked token all return the
 *     same 404. Nothing distinguishes "never existed" from "was turned off",
 *     so a link that stops working reveals nothing about why.
 *   * The response carries the set list only — no user id, no username, no
 *     other playlist. See repo.getPlaylistByShareToken.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const limit = rateLimit(callerId(request, "shared-read"), 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many requests.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { token } = await context.params;

  try {
    const playlist = await getPlaylistByShareToken(token);
    if (!playlist) return fail("not_found", "This link is not valid.", 404);
    return json({ playlist });
  } catch (error) {
    return handleError("shared/read", error);
  }
}
