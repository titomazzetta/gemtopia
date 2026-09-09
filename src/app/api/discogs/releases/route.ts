import type { NextRequest } from "next/server";
import { z } from "zod";
import { getRelease, DiscogsError } from "@/lib/discogs";
import { getSession } from "@/lib/session";
import { fail, handleError, json, unauthorized } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import type { ReleaseDetail } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Discogs allows 60 authenticated requests/minute. Batches stay well under. */
const MAX_BATCH = 8;

const querySchema = z.object({
  ids: z
    .string()
    .min(1)
    .transform((raw, ctx) => {
      const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0 || parts.length > MAX_BATCH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Between 1 and ${MAX_BATCH} ids`,
        });
        return z.NEVER;
      }
      const ids: number[] = [];
      for (const p of parts) {
        const n = Number(p);
        if (!Number.isInteger(n) || n <= 0 || n > 1e9) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "ids must be positive integers",
          });
          return z.NEVER;
        }
        ids.push(n);
      }
      return [...new Set(ids)];
    }),
});

/**
 * Batch release detail: tracklists and YouTube video IDs.
 *
 * Requests inside a batch run with bounded concurrency. A single failing
 * release is reported per-item rather than failing the whole batch, so a
 * deleted or region-blocked release does not stall a 1,500-record sync.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  // 12 batches/min x 8 = 96 upstream calls/min ceiling per user. The client
  // paces below that; this is the hard stop if it misbehaves.
  const limit = rateLimit(callerId(request, "discogs-releases", session.u), 12, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Sync is going too fast; pausing.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return fail("bad_request", "Invalid release ids.", 400);
  }

  const user = { token: session.t, tokenSecret: session.s };
  const ids = parsed.data.ids;

  try {
    const results: Array<
      { id: number; ok: true; release: ReleaseDetail } | { id: number; ok: false; status: number }
    > = [];

    // Concurrency 3: fast enough to sync 1,500 releases in ~10 minutes,
    // gentle enough that Discogs never returns 429 in practice.
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        try {
          results.push({ id, ok: true, release: await getRelease(user, id) });
        } catch (error) {
          if (error instanceof DiscogsError && error.status === 429) throw error;
          results.push({
            id,
            ok: false,
            status: error instanceof DiscogsError ? error.status : 500,
          });
        }
      }
    });

    await Promise.all(workers);

    return json({ results });
  } catch (error) {
    return handleError("discogs/releases", error);
  }
}
