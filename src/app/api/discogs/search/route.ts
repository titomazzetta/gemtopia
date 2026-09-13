import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { searchReleases } from "@/lib/discogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search Discogs for a release you are holding.
 *
 * Separate from the dig endpoint, which searches on *your* records' metadata
 * to find neighbours. This one takes what a person typed, or what was read off
 * a label, and looks for that pressing.
 *
 * A read, so no CSRF guard — but still behind `requireUser`, because these
 * requests are signed with the caller's own Discogs token and count against
 * their 60/minute, not some shared pool.
 */
const querySchema = z
  .object({
    q: z.string().trim().min(2).max(120).optional(),
    /*
     * Catalogue number and barcode are separate parameters rather than being
     * folded into `q`, because Discogs treats them as exact-match fields.
     * "PF-045" in a free-text query competes with every release whose notes
     * mention it; in `catno` it identifies a pressing.
     */
    catno: z.string().trim().min(1).max(60).optional(),
    barcode: z.string().trim().min(6).max(20).optional(),
    /*
     * Searches tracklists, which `q` does not. Without this, looking for a
     * track only works when its name also appears in the release title — so
     * the common case of "I know the track, I want the EP it is on" quietly
     * returned nothing.
     */
    track: z.string().trim().min(2).max(120).optional(),
    page: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict()
  .refine((v) => v.q || v.catno || v.barcode || v.track, {
    message: "Give something to search for",
  });

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  /*
   * Tighter than the collection read. Every keystroke in a search box is a
   * potential upstream call, and Discogs' ceiling is 60/minute for the whole
   * account — exhausting it here would stall a collection sync running in
   * another tab, which is a much worse outcome than a slow search.
   */
  const limit = rateLimit(`search:${auth.username}`, 20, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Searching a little fast — one moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return fail("bad_request", "Give something to search for.", 400);
    }

    const hits = await searchReleases(
      { token: auth.session.t, tokenSecret: auth.session.s },
      {
        query: parsed.data.q,
        catno: parsed.data.catno,
        barcode: parsed.data.barcode,
        track: parsed.data.track,
        page: parsed.data.page ?? 1,
        perPage: 25,
      },
    );

    return json({ results: hits });
  } catch (error) {
    return handleError("discogs/search", error);
  }
}
