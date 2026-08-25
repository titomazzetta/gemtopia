import type { NextRequest } from "next/server";
import { z } from "zod";
import { getCollectionPage, getWantlistPage } from "@/lib/discogs";
import { getSession } from "@/lib/session";
import { fail, handleError, json, unauthorized } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(100),
  source: z.enum(["collection", "wantlist"]).default("collection"),
});

/**
 * Paged listing of the signed-in user's collection or wantlist.
 *
 * The username comes from the *session*, never from a query parameter — that
 * is what stops one authenticated user enumerating another user's private
 * collection through our credentials (IDOR).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const limit = rateLimit(callerId(request, session.u), 40, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("bad_request", "Invalid pagination parameters.", 400);
  }

  const { page, perPage, source } = parsed.data;
  const user = { token: session.t, tokenSecret: session.s };

  try {
    const data =
      source === "wantlist"
        ? await getWantlistPage(user, session.u, page, perPage)
        : await getCollectionPage(user, session.u, page, perPage);

    return json(data);
  } catch (error) {
    return handleError("discogs/collection", error);
  }
}
