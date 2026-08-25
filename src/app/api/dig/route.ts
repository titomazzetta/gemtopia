import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { digFromRelease } from "@/lib/dig";
import { recordDigSeen } from "@/lib/repo";
import type { DigResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Dig from one release.
 *
 * The seed's metadata is supplied by the client from its own collection cache,
 * exactly as in /api/insights: it is the user's own data, it only affects what
 * that user sees, and re-fetching it upstream would spend a Discogs request to
 * learn something the browser already knows.
 *
 * Unlike /api/insights this one is not cached and has no LLM pass — it is meant
 * to answer in about a second and to be hit repeatedly.
 */
const bodySchema = z
  .object({
    seed: z
      .object({
        releaseId: z.number().int().positive(),
        artistIds: z.array(z.number().int().positive()).max(12).default([]),
        artistNames: z.array(z.string().max(200)).max(12).default([]),
        labelIds: z.array(z.number().int().positive()).max(12).default([]),
        labelNames: z.array(z.string().max(200)).max(12).default([]),
        styles: z.array(z.string().max(80)).max(12).default([]),
        genres: z.array(z.string().max(80)).max(12).default([]),
        year: z.number().int().min(1880).max(2200).nullable().default(null),
        country: z.string().max(80).nullable().default(null),
      })
      .strict(),
    /** Collection ids, so we never suggest something already owned. */
    excludeReleaseIds: z.array(z.number().int().positive()).max(20_000).default([]),
    /** Ids already shown this session, so "dig again" moves forward. */
    seenReleaseIds: z.array(z.number().int().positive()).max(2_000).default([]),
    /** Whether wantlist items should still be shown (they usually should). */
    includeWantlist: z.boolean().default(true),
    wantlistReleaseIds: z.array(z.number().int().positive()).max(20_000).default([]),
  })
  .strict();

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // Four upstream calls per dig; 10/min keeps a user under a quarter of the
  // Discogs budget even while hammering the button.
  const limit = rateLimit(`dig:${auth.username}`, 10, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Digging too fast — give it a few seconds.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid dig request.", 400);
    }
    const body = parsed.data;

    const exclude = new Set(body.excludeReleaseIds);
    if (!body.includeWantlist) {
      for (const id of body.wantlistReleaseIds) exclude.add(id);
    }

    const lanes = await digFromRelease({
      user: { token: auth.session.t, tokenSecret: auth.session.s },
      seed: body.seed,
      exclude,
      seen: new Set(body.seenReleaseIds),
    });

    // Remember what was surfaced so the feed keeps moving between sessions.
    const shown = lanes.flatMap((lane) => lane.results.map((r) => r.releaseId));
    if (shown.length > 0) {
      await recordDigSeen(auth.userId, shown, body.seed.releaseId).catch(
        (error) => console.warn("[dig] could not record impressions", error),
      );
    }

    const response: DigResponse = {
      seedReleaseId: body.seed.releaseId,
      lanes,
      fetchedAt: Date.now(),
    };

    return json(response);
  } catch (error) {
    return handleError("dig", error);
  }
}
