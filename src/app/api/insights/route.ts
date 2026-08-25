import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { getCachedAnalysis, getPlaylist, listTrackMeta, saveAnalysis } from "@/lib/repo";
import {
  buildProfile,
  fingerprint,
  generateRecommendations,
  type Seed,
} from "@/lib/recommend";
import { rankWithClaude } from "@/lib/llm";
import { LLM_ENABLED } from "@/lib/env";
import type { AnalysisResult, PlaylistProfile, Recommendation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The graph walk makes ~12 Discogs calls; give it room.
export const maxDuration = 60;

/**
 * Seed metadata comes from the *client's* collection cache rather than being
 * re-fetched from Discogs. That saves ~40 upstream requests per analysis, and
 * the trust implication is contained: a user can only skew the recommendations
 * they themselves see, for their own playlist. The playlist membership itself
 * is read from the database, not from the request — so seeds for releases that
 * are not actually in the playlist are ignored.
 */
const seedSchema = z
  .object({
    releaseId: z.number().int().positive(),
    artistIds: z.array(z.number().int().positive()).max(24).default([]),
    artistNames: z.array(z.string().max(200)).max(24).default([]),
    labelIds: z.array(z.number().int().positive()).max(24).default([]),
    labelNames: z.array(z.string().max(200)).max(24).default([]),
    styles: z.array(z.string().max(80)).max(24).default([]),
    genres: z.array(z.string().max(80)).max(24).default([]),
    country: z.string().max(80).nullable().default(null),
    year: z.number().int().min(1880).max(2200).nullable().default(null),
  })
  .strict();

const bodySchema = z
  .object({
    playlistId: z.string().uuid(),
    refresh: z.boolean().default(false),
    seeds: z.array(seedSchema).max(500).default([]),
    ownedReleaseIds: z.array(z.number().int().positive()).max(20_000).default([]),
    wantlistReleaseIds: z.array(z.number().int().positive()).max(20_000).default([]),
  })
  .strict();

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // Expensive endpoint: Discogs requests plus optional LLM tokens.
  const limit = rateLimit(`insights:${auth.username}`, 6, 60_000);
  if (!limit.ok) {
    return fail(
      "rate_limited",
      "Analysis is rate limited. Try again shortly.",
      429,
      { retryAfter: limit.resetSeconds },
    );
  }

  try {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("bad_request", "Invalid analysis request.", 400);
    }
    const body = parsed.data;

    // Authoritative playlist contents, scoped to this user.
    const playlist = await getPlaylist(auth.userId, body.playlistId);
    if (!playlist) return fail("not_found", "No such playlist.", 404);
    if (playlist.entries.length === 0) {
      return fail("empty", "That playlist has no tracks to analyse.", 400);
    }

    const print = await fingerprint(playlist.entries.map((e) => e.clipKey));

    if (!body.refresh) {
      const cached = await getCachedAnalysis(auth.userId, body.playlistId, print);
      if (cached) {
        const result: AnalysisResult = {
          profile: cached.profile as PlaylistProfile,
          recommendations: cached.recommendations as Recommendation[],
          summary:
            (cached.profile as { summary?: string | null })?.summary ?? null,
          usedLlm: cached.usedLlm,
          cachedAt: cached.createdAt,
        };
        return json({ ...result, llmAvailable: LLM_ENABLED });
      }
    }

    /* ---- profile ---- */

    // Only seeds for releases genuinely in the playlist are honoured.
    const playlistReleaseIds = new Set(playlist.entries.map((e) => e.releaseId));
    const seeds: Seed[] = body.seeds
      .filter((s) => playlistReleaseIds.has(s.releaseId))
      .map((s) => ({ ...s }));

    if (seeds.length === 0) {
      return fail(
        "no_metadata",
        "Your collection cache is still syncing — try again once it finishes.",
        409,
      );
    }

    const catalogue = await listTrackMeta(auth.userId);
    const bpmByClip = new Map(
      catalogue
        .filter((m) => m.bpm !== null)
        .map((m) => [m.clipKey, m.bpm as number]),
    );
    const bpms = playlist.entries
      .map((e) => bpmByClip.get(e.clipKey))
      .filter((b): b is number => b !== undefined);

    const profile = buildProfile(seeds, playlist.entries.length, bpms);

    /* ---- graph walk ---- */

    const { recommendations: graphRecs, adjacentLabels } =
      await generateRecommendations({
        user: { token: auth.session.t, tokenSecret: auth.session.s },
        seeds,
        profile,
        owned: new Set(body.ownedReleaseIds),
        wantlist: new Set(body.wantlistReleaseIds),
      });

    profile.adjacentLabels = adjacentLabels;

    /* ---- optional ranking pass ---- */

    const outcome = await rankWithClaude({
      userId: auth.userId,
      profile,
      candidates: graphRecs,
    });

    const result: AnalysisResult = {
      profile,
      recommendations: outcome.recommendations,
      summary: outcome.summary,
      usedLlm: outcome.usedLlm,
      cachedAt: null,
    };

    await saveAnalysis({
      userId: auth.userId,
      playlistId: body.playlistId,
      fingerprint: print,
      // The summary rides along inside the stored profile so the cache hit
      // above can return it without a second column.
      profile: { ...profile, summary: outcome.summary },
      recommendations: outcome.recommendations,
      usedLlm: outcome.usedLlm,
    });

    return json({
      ...result,
      llmAvailable: LLM_ENABLED,
      llmSkipped: outcome.skipped ?? null,
    });
  } catch (error) {
    return handleError("insights", error);
  }
}
