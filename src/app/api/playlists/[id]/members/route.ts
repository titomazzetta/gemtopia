import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { removeCollaborator } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({ username: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/) })
  .strict();

/**
 * DELETE — take someone off a collaborative playlist.
 *
 * The owner can remove anyone; a collaborator can remove only themselves,
 * which is how leaving works. Any other combination is a 404, the same as a
 * playlist you cannot see. See repo.removeCollaborator.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-members", auth.username), 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "No such playlist.", 404);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid", "Expected { username }.", 400);

  try {
    const removed = await removeCollaborator(auth.userId, id, parsed.data.username);
    if (!removed) return fail("not_found", "No such collaborator.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("playlists/members/remove", error);
  }
}
