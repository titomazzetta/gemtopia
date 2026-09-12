import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { addToCollection } from "@/lib/discogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ releaseId: z.number().int().positive().max(1e9) })
  .strict();

/**
 * Collection writes.
 *
 * Deliberately a near-copy of the wantlist route rather than a shared
 * abstraction. These are the only two places in the application that change
 * data on someone's Discogs account, and the value of being able to read one
 * of them top to bottom and see every guard in order outweighs the duplication
 * of about fifteen lines. A helper that hid the CSRF check inside itself would
 * make the next write route easier to add and harder to audit.
 *
 * Note what is absent: there is no DELETE. Adding is what you need from a
 * phone with a record in your hand; removing is rare, destructive, and belongs
 * on Discogs where you can see what you are deleting. The sign-in page
 * promises this app never removes anything from your collection, and the
 * cheapest way to keep that promise is for the code to be incapable of it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  /*
   * Same budget as the wantlist. Adding a delivery of records is a handful of
   * writes over a few minutes; anything approaching thirty a minute is a stuck
   * button or a script, and either way Discogs' own 60/min ceiling is the one
   * that would bite next.
   */
  const limit = rateLimit(`collect:${auth.username}`, 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return fail("bad_request", "Invalid release id.", 400);

    await addToCollection(
      // The username comes from the session, never the request body. A release
      // id is the only thing a caller gets to choose.
      { token: auth.session.t, tokenSecret: auth.session.s },
      auth.username,
      parsed.data.releaseId,
    );

    /*
     * Not written to dig_log. Its CHECK constraint allows only 'seen',
     * 'previewed', 'wanted' and 'dismissed' — a 'collected' row would have
     * thrown, and the `.catch(() => {})` the wantlist route uses would have
     * swallowed it silently forever. It does not belong there anyway: dig_log
     * is feedback for the recommender, and a record you actually bought turns
     * up as owned on the next sync without any help.
     */

    return json({ ok: true, releaseId: parsed.data.releaseId, collected: true });
  } catch (error) {
    return handleError("collection/add", error);
  }
}
