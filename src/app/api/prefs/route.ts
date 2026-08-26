import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getPrefs, setPitchPercent } from "@/lib/repo";
import { MAX_PITCH_PERCENT, MIN_PITCH_PERCENT } from "@/lib/mixing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    pitchPercent: z
      .number()
      .int()
      .min(MIN_PITCH_PERCENT)
      .max(MAX_PITCH_PERCENT),
  })
  .strict();

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return json(await getPrefs(auth.userId));
  } catch (error) {
    return handleError("prefs/get", error);
  }
}

/** Set the deck pitch range. The only preference there is, so far. */
export async function PATCH(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(`prefs:${auth.username}`, 30, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Pitch range must be 1–100%.", 400);
    }
    return json(await setPitchPercent(auth.userId, parsed.data.pitchPercent));
  } catch (error) {
    return handleError("prefs/patch", error);
  }
}
