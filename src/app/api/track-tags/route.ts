import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { listTrackTags, setTrackTags } from "@/lib/repo";
import { normaliseTags, TAG_MAX_CHARS, TAGS_PER_TRACK } from "@/lib/tags";
import { trackTagsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — every tag you've put on a track. Yours only: the query is keyed on
 * the session's user, and no other route reads this table.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  try {
    return json({ entries: await listTrackTags(auth.userId) });
  } catch (error) {
    return handleError("track-tags/list", error);
  }
}

const REFUSED: Record<"empty" | "too_long" | "too_many", string> = {
  empty: "A tag needs at least one letter, number or symbol.",
  too_long: `A tag can be up to ${TAG_MAX_CHARS} characters.`,
  too_many: `A track can have up to ${TAGS_PER_TRACK} tags.`,
};

/**
 * PUT — one track's tags, the whole set: `{ clipKey, tags }`. An empty list
 * clears them. Answers with what's stored, in stored form.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // People type tags one at a time; this is several a second for a minute.
  const limit = rateLimit(callerId(request, "track-tags-write", auth.username), 120, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many tag changes.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const parsed = trackTagsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("bad_request", "Expected a clipKey and a list of tags.", 400);
    }

    const tags = normaliseTags(parsed.data.tags);
    if (!tags.ok) return fail("bad_tag", REFUSED[tags.reason], 400);

    const saved = await setTrackTags(auth.userId, parsed.data.clipKey, tags.tags);
    if (!saved.ok) {
      return fail("tag_limit", "That's as many tags as one account can hold. Remove some first.", 409);
    }
    return json({ clipKey: parsed.data.clipKey, tags: saved.tags });
  } catch (error) {
    return handleError("track-tags/set", error);
  }
}
