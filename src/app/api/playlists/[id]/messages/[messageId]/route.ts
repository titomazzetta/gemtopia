import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { deleteMessage } from "@/lib/repo";
import { isMessageId } from "@/lib/chat";
import { UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

/**
 * DELETE — take a message down. Its author can; the playlist's owner can.
 * Every other combination is the same 404 as a message that never existed,
 * so this cannot be used to probe which ids are real. See repo.deleteMessage.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-chat-delete", auth.username), 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id, messageId } = await params;
  if (!UUID.safeParse(id).success || !isMessageId(messageId)) {
    return fail("not_found", "No such message.", 404);
  }

  try {
    const ok = await deleteMessage(auth.userId, id, messageId);
    if (!ok) return fail("not_found", "No such message.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("playlists/messages/delete", error);
  }
}
