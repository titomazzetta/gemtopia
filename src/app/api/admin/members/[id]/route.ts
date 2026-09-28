import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { ADMIN_KEYS } from "@/lib/invites";
import { removeMember } from "@/lib/repo";
import { UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Take a member's access away. Signs them out everywhere on their next
 * request and stops them signing back in, until someone gives them a fresh
 * code. Their playlists are kept. Admins cannot be removed (repo.removeMember).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "member-remove", auth.username), 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, { retryAfter: limit.resetSeconds });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) return fail("bad_request", "Invalid member id.", 400);

  try {
    const removed = await removeMember(id, ADMIN_KEYS);
    if (!removed) return fail("not_found", "No removable member with that id.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("admin/members/remove", error);
  }
}
