import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { addToWantlist, removeFromWantlist } from "@/lib/discogs";
import { recordDigAction } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ releaseId: z.number().int().positive().max(1e9) })
  .strict();

/**
 * Wantlist writes.
 *
 * This is the only route in the application that changes data on Discogs, so
 * it is the one place where a CSRF failure would have consequences a user
 * could see in someone else's product. It goes through the same
 * `requireUser(..., { mutating: true })` guard as everything else — Origin
 * check, SameSite cookies, double-submit token — and the username used to
 * build the upstream URL comes from the session, never from the request.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(`want:${auth.username}`, 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("bad_request", "Invalid release id.", 400);

    await addToWantlist(
      { token: auth.session.t, tokenSecret: auth.session.s },
      auth.username,
      parsed.data.releaseId,
    );

    await recordDigAction(auth.userId, parsed.data.releaseId, "wanted").catch(
      () => {},
    );

    return json({ ok: true, releaseId: parsed.data.releaseId, wanted: true });
  } catch (error) {
    return handleError("wantlist/add", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(`want:${auth.username}`, 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const raw = request.nextUrl.searchParams.get("releaseId");
    const parsed = bodySchema.safeParse({ releaseId: Number(raw) });
    if (!parsed.success) return fail("bad_request", "Invalid release id.", 400);

    await removeFromWantlist(
      { token: auth.session.t, tokenSecret: auth.session.s },
      auth.username,
      parsed.data.releaseId,
    );

    return json({ ok: true, releaseId: parsed.data.releaseId, wanted: false });
  } catch (error) {
    return handleError("wantlist/remove", error);
  }
}
