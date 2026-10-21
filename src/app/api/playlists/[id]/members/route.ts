import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { removeCollaborator, setMemberRole } from "@/lib/repo";
import { MEMBER_ROLES } from "@/lib/roles";

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

const roleSchema = z
  .object({
    username: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    role: z.enum(MEMBER_ROLES),
  })
  .strict();

/**
 * PATCH — what one person on the set may do: `{ username, role }`, role one
 * of "viewer", "editor", "full" (lib/roles.ts).
 *
 * The owner's alone. Anyone else asking — a member at any level, a stranger —
 * gets the same 404 as for a playlist they can't see, because the owner check
 * is in the query (repo.setMemberRole). So is "they're on this set": there's
 * no way to give a level to someone who hasn't joined.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
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

  const parsed = roleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid", 'Expected { username, role } with role "viewer", "editor" or "full".', 400);
  }

  try {
    const result = await setMemberRole(auth.userId, id, parsed.data.username, parsed.data.role);
    if (result === "not_found") return fail("not_found", "No such collaborator.", 404);
    return json({ ok: true, changed: result === "ok" });
  } catch (error) {
    return handleError("playlists/members/role", error);
  }
}
