import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { setPlaylistShare } from "@/lib/repo";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ shared: z.boolean() }).strict();

/**
 * POST — turn a share link on or off for one playlist.
 *
 * Owner-only, like everything else under /api/playlists. The link this returns
 * is the only thing that can read the playlist anonymously, and setting
 * `shared: false` destroys it permanently rather than parking it: an
 * "unshare" that could be undone would mean a link you thought you killed
 * still works, which is the opposite of what anyone pressing it intends.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-share", auth.username), 20, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many share changes.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    // Same 404 a stranger's playlist gets: the response never confirms
    // whether an id exists.
    return fail("not_found", "No such playlist.", 404);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid", "Expected { shared: boolean }.", 400);

  try {
    const result = await setPlaylistShare(auth.userId, id, parsed.data.shared);

    // Not yours, or not there. Indistinguishable on purpose.
    if (!result) return fail("not_found", "No such playlist.", 404);

    return json({
      shared: result.shareToken !== null,
      // Absolute, because the point of this value is to be copied and sent.
      shareUrl: result.shareToken
        ? `${env.APP_ORIGIN}/s/${result.shareToken}`
        : null,
    });
  } catch (error) {
    return handleError("playlists/share", error);
  }
}
