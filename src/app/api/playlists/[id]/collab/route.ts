import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { getJoinLink, setJoinLink } from "@/lib/repo";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const joinUrl = (token: string | null) =>
  token ? `${env.APP_ORIGIN}/join/${token}` : null;

/**
 * The join link for a collaborative playlist. Owner only — anyone else, a
 * collaborator included, gets the same 404 a stranger's playlist gets.
 *
 * GET  — the current link, to copy again. Null when it is off.
 * POST — `{ on: true }` mints a new link (the old one stops working);
 *        `{ on: false }` turns it off. People already in stay in.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "No such playlist.", 404);
  }

  try {
    const result = await getJoinLink(auth.userId, id);
    if (!result) return fail("not_found", "No such playlist.", 404);
    return json({ on: result.token !== null, url: joinUrl(result.token) });
  } catch (error) {
    return handleError("playlists/collab/get", error);
  }
}

const bodySchema = z.object({ on: z.boolean() }).strict();

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-collab", auth.username), 20, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many link changes.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "No such playlist.", 404);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid", "Expected { on: boolean }.", 400);

  try {
    const result = await setJoinLink(auth.userId, id, parsed.data.on);
    if (!result) return fail("not_found", "No such playlist.", 404);
    return json({ on: result.token !== null, url: joinUrl(result.token) });
  } catch (error) {
    return handleError("playlists/collab/set", error);
  }
}
