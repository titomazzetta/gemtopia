import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { deleteTrackMeta, listTrackMeta, upsertTrackMeta } from "@/lib/repo";
import { trackMetaBatchSchema, CLIP_KEY } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — the whole BPM/key catalogue for this user. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return json({ entries: await listTrackMeta(auth.userId) });
  } catch (error) {
    return handleError("track-meta/list", error);
  }
}

/**
 * PUT — batch upsert of BPM readings.
 *
 * The auto-detector flushes here every few seconds while music plays, so this
 * gets a generous limit; the precedence rules that stop an automatic reading
 * clobbering a tapped one live in SQL (see repo.upsertTrackMeta), not here.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "track-meta-write", auth.username), 120, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many BPM writes.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = trackMetaBatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid track metadata.", 400);
    }

    const written = await upsertTrackMeta(auth.userId, parsed.data.entries);
    return json({ written });
  } catch (error) {
    return handleError("track-meta/upsert", error);
  }
}

/**
 * DELETE — forget one reading, so it can be measured again from scratch.
 *
 * The alternative would be a "force" flag on the upsert, but that hands every
 * writer a way to bypass the precedence rules, and the auto-detector is a
 * writer. Deleting is narrower: it can only remove your own row, and the next
 * reading then wins on merit rather than on a flag.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "track-meta-delete", auth.username), 60, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many requests.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const body = await request.json().catch(() => null);
  const parsed = z.object({ clipKey: CLIP_KEY }).strict().safeParse(body);
  if (!parsed.success) {
    return fail("invalid", "Expected a single clipKey.", 400);
  }

  try {
    const removed = await deleteTrackMeta(auth.userId, parsed.data.clipKey);
    return json({ removed });
  } catch (error) {
    return handleError("track-meta/delete", error);
  }
}
