import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { duplicatePlaylist } from "@/lib/repo";
import { UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/playlists/:id/duplicate — your own private copy of a playlist
 * you can see: yours, or a shared one you're on.
 *
 * The request is the id and nothing else. The server copies what it already
 * lets you read (repo.duplicatePlaylist, CAN_EDIT in the statement), so
 * there is no client-supplied content to validate and no way to copy a
 * playlist you couldn't already open: someone else's is the same 404 as
 * reading it. The copy has no collaborators, links or chat. Same CSRF,
 * Origin and rate-limit rules as creating a playlist, because it is one.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // The create budget: a copy is a create.
  const limit = rateLimit(callerId(request, "playlists", auth.username), 60, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) {
    return fail("bad_request", "Invalid playlist id.", 400);
  }

  try {
    const playlist = await duplicatePlaylist(auth.userId, id);
    if (!playlist) return fail("not_found", "No such playlist.", 404);
    return json({ playlist }, { status: 201 });
  } catch (error) {
    return handleError("playlists/duplicate", error);
  }
}
