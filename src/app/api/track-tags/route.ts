import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { listTrackTags, setTrackTags } from "@/lib/repo";
import { normaliseTags, TAG_MAX_CHARS, TAGS_PER_TRACK } from "@/lib/tags";
import { trackTagsBatchSchema, trackTagsSchema } from "@/lib/validation";

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
 * PUT — tracks' tags, each its whole set. Either one track,
 * `{ clipKey, tags }`, answered with `{ clipKey, tags }`; or a selection,
 * `{ entries: [{ clipKey, tags }, …] }` (up to TRACK_TAGS_BATCH_MAX, each
 * track once), answered with `{ entries }`. An empty list clears a track.
 * Answers with what's stored, in stored form. A batch is all or nothing: one
 * bad tag refuses the request and nothing changes.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // People type tags one at a time; this is several a second for a minute.
  // A selection's tags count once per request of up to 200 tracks.
  const limit = rateLimit(callerId(request, "track-tags-write", auth.username), 120, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Too many tag changes.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  try {
    const body: unknown = await request.json().catch(() => null);
    const one = trackTagsSchema.safeParse(body);
    let asked: Array<{ clipKey: string; tags: string[] }>;
    if (one.success) {
      asked = [one.data];
    } else {
      const many = trackTagsBatchSchema.safeParse(body);
      if (!many.success) {
        return fail("bad_request", "Expected a clipKey and a list of tags, or a list of those.", 400);
      }
      asked = many.data.entries;
    }

    const entries: Array<{ clipKey: string; tags: string[] }> = [];
    for (const entry of asked) {
      const tags = normaliseTags(entry.tags);
      if (!tags.ok) return fail("bad_tag", REFUSED[tags.reason], 400);
      entries.push({ clipKey: entry.clipKey, tags: tags.tags });
    }

    const saved = await setTrackTags(auth.userId, entries);
    if (!saved.ok) {
      return fail("tag_limit", "That's as many tags as one account can hold. Remove some first.", 409);
    }
    return json(one.success ? saved.entries[0] : { entries: saved.entries });
  } catch (error) {
    return handleError("track-tags/set", error);
  }
}
