import type { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { revokeInvite } from "@/lib/repo";
import { UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Kill an unused code you made. A used one has done its job — remove the member instead. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireAdmin(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "invite-revoke", auth.username), 60, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, { retryAfter: limit.resetSeconds });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) return fail("bad_request", "Invalid invite id.", 400);

  try {
    const revoked = await revokeInvite(auth.userId, id);
    if (!revoked) return fail("not_found", "No unused code with that id.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("admin/invites/revoke", error);
  }
}
