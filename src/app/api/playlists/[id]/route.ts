import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import {
  deletePlaylist,
  getPlaylist,
  renamePlaylist,
  replaceItems,
} from "@/lib/repo";
import { updatePlaylistSchema, UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Note what is *absent* from every handler below: an ownership check written
 * by hand. The repo functions take `userId` as their first argument and put it
 * in the WHERE clause, so a playlist belonging to someone else simply does not
 * exist from this request's point of view — it 404s rather than 403s, which
 * also avoids confirming that the id is real.
 */

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!UUID.safeParse(id).success) {
    return fail("bad_request", "Invalid playlist id.", 400);
  }

  try {
    const playlist = await getPlaylist(auth.userId, id);
    if (!playlist) return fail("not_found", "No such playlist.", 404);
    return json({ playlist });
  } catch (error) {
    return handleError("playlists/get", error);
  }
}

/** PATCH — rename, replace contents (reorder / add / remove), or both. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-item", auth.username), 120, 60_000);
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
    const parsed = updatePlaylistSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid update payload.", 400);
    }

    if (parsed.data.name !== undefined) {
      const ok = await renamePlaylist(auth.userId, id, parsed.data.name);
      if (!ok) return fail("not_found", "No such playlist.", 404);
    }

    if (parsed.data.entries !== undefined) {
      const result = await replaceItems(
        auth.userId,
        id,
        parsed.data.entries.map((e, i) => ({ ...e, position: i })),
        parsed.data.version,
      );
      if (result === "not_found") return fail("not_found", "No such playlist.", 404);
      if (result === "not_yours") {
        // A collaborator tried to take out someone else's record. Refused
        // whole; hand back the list as it is so the client can put it back.
        const current = await getPlaylist(auth.userId, id);
        return fail(
          "not_your_record",
          "You can only take out records you added. Ask the owner to remove the others.",
          403,
          { playlist: current },
        );
      }
      if (result === "conflict") {
        // Someone else changed it first. Hand back what it is now, so the
        // client can show it and the person can redo their edit on top.
        const current = await getPlaylist(auth.userId, id);
        return fail(
          "playlist_changed",
          "Someone else just changed this playlist. It's been refreshed — try that again.",
          409,
          { playlist: current },
        );
      }
    }

    const playlist = await getPlaylist(auth.userId, id);
    if (!playlist) return fail("not_found", "No such playlist.", 404);
    return json({ playlist });
  } catch (error) {
    return handleError("playlists/update", error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!UUID.safeParse(id).success) {
    return fail("bad_request", "Invalid playlist id.", 400);
  }

  try {
    const ok = await deletePlaylist(auth.userId, id);
    if (!ok) return fail("not_found", "No such playlist.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("playlists/delete", error);
  }
}
