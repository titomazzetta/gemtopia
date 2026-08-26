import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { revokeAllSessions } from "@/lib/repo";
import { destroySession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out of every device.
 *
 * Bumping `session_version` invalidates every cookie this user holds —
 * including the one that made this request, which is why the local cookie is
 * cleared straight afterwards. There is no "revoke that other device" variant
 * because stateless sessions carry nothing to distinguish devices by; the
 * honest control is all-or-nothing, and saying so is better than shipping a
 * per-device list that quietly does the same thing.
 *
 * This does not touch the OAuth grant on Discogs' side — that lives in the
 * user's Discogs settings and is theirs to revoke. What it guarantees is that
 * no cookie we previously issued can act on their behalf again.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(`revoke:${auth.username}`, 5, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many attempts. Wait a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const version = await revokeAllSessions(auth.userId);
    await destroySession();
    return json({ ok: true, sessionVersion: version });
  } catch (error) {
    return handleError("auth/revoke", error);
  }
}
