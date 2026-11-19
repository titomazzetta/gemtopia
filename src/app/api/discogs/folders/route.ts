import type { NextRequest } from "next/server";
import { getCollectionFolders } from "@/lib/discogs";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's own collection folders: names and counts, one
 * request. What the Folder filter shows as chips, and what turns the folder
 * ids on each collection row into words.
 *
 * The username comes from the session, never from the request — the same
 * rule as the collection listing, for the same reason: nobody reads another
 * account's folders through our credentials. No parameters at all, so there
 * is nothing to validate; a request with any is still answered with this
 * user's folders.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const { session } = auth;

  // Once a visit is the normal rate; ten a minute leaves room for a retry.
  const limit = rateLimit(callerId(request, "discogs-folders", session.u), 10, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const folders = await getCollectionFolders({ token: session.t, tokenSecret: session.s }, session.u);
    return json({ folders });
  } catch (error) {
    return handleError("discogs/folders", error);
  }
}
