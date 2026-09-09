import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import {
  createPlaylist,
  listPlaylists,
} from "@/lib/repo";
import { createPlaylistSchema, importPlaylistsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/playlists — every playlist this user owns, with items. */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return json({ playlists: await listPlaylists(auth.userId) });
  } catch (error) {
    return handleError("playlists/list", error);
  }
}

/** POST /api/playlists — create one, optionally seeded with entries. */
export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlists", auth.username), 60, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = createPlaylistSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid playlist payload.", 400);
    }

    const playlist = await createPlaylist(
      auth.userId,
      parsed.data.name,
      parsed.data.entries.map((e, i) => ({ ...e, position: i })),
    );

    return json({ playlist }, { status: 201 });
  } catch (error) {
    return handleError("playlists/create", error);
  }
}

/**
 * PUT /api/playlists — one-time import of playlists that were created in the
 * browser before the server store existed. Additive: it never deletes.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(`import:${auth.username}`, 3, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Import already running.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = importPlaylistsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid import payload.", 400);
    }

    let imported = 0;
    for (const entry of parsed.data.playlists) {
      await createPlaylist(
        auth.userId,
        entry.name,
        entry.entries.map((e, i) => ({ ...e, position: i })),
      );
      imported += 1;
    }

    return json({ imported, playlists: await listPlaylists(auth.userId) });
  } catch (error) {
    return handleError("playlists/import", error);
  }
}
