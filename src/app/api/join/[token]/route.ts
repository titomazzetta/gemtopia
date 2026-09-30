import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { isJoinToken } from "@/lib/collab";
import { joinPlaylist, previewJoin } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Join links, for signed-in members only.
 *
 * GET  — what you'd be joining (name, owner, size) — not the records.
 * POST — join. Only ever the result of someone pressing Join on the page.
 *
 * A dead, wrong or malformed link is one indistinguishable 404. Tokens are
 * 256-bit random, so the limit below is not what stops guessing — it stops a
 * leaked link being hammered.
 */
async function guard(request: NextRequest, params: Params["params"], mutating: boolean) {
  const auth = await requireUser(request, { mutating });
  if ("response" in auth) return auth;

  const limit = rateLimit(callerId(request, "playlist-join", auth.username), 30, 10 * 60_000);
  if (!limit.ok) {
    return {
      response: fail("rate_limited", "Too many tries. Wait a few minutes.", 429, {
        retryAfter: limit.resetSeconds,
      }),
    };
  }

  const { token } = await params;
  if (!isJoinToken(token)) {
    return { response: fail("not_found", "This link isn't active.", 404) };
  }
  return { auth, token };
}

export async function GET(request: NextRequest, { params }: Params) {
  const g = await guard(request, params, false);
  if ("response" in g) return g.response;
  try {
    const preview = await previewJoin(g.auth.userId, g.token);
    if (!preview) return fail("not_found", "This link isn't active.", 404);
    return json({ preview });
  } catch (error) {
    return handleError("join/preview", error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const g = await guard(request, params, true);
  if ("response" in g) return g.response;
  try {
    const result = await joinPlaylist(g.auth.userId, g.token);
    if (!result) return fail("not_found", "This link isn't active.", 404);
    if (result.status === "full") {
      return fail("full", "This playlist already has as many collaborators as it can take.", 409);
    }
    return json(result);
  } catch (error) {
    return handleError("join/join", error);
  }
}
