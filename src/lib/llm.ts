import "server-only";
import { z } from "zod";
import { env, LLM_ENABLED } from "./env";
import { outputTokensLast24h, recordLlmUsage } from "./repo";
import type { PlaylistProfile, Recommendation } from "./types";

/**
 * Optional Claude ranking pass.
 *
 * Contract, and the reason the whole module is shaped this way:
 *
 *   The model may **reorder** and **explain** the candidates the Discogs graph
 *   found. It may not add to them.
 *
 * Any release id in the response that was not in the request is discarded
 * before it reaches the UI. That single filter is what makes "AI
 * recommendations" safe to act on — a DJ who walks into a shop with a
 * catalogue number needs it to exist. The model contributes judgement about
 * ordering and a written characterisation; the facts stay with Discogs.
 *
 * Absent an API key, none of this runs and the deterministic ordering is used
 * as-is. Nothing in the product hard-depends on it.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 2_000;

const responseSchema = z.object({
  summary: z.string().max(1200),
  ranking: z
    .array(
      z.object({
        releaseId: z.number().int().positive(),
        reason: z.string().max(300),
      }),
    )
    .max(40),
});

const apiResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

function buildPrompt(
  profile: PlaylistProfile,
  candidates: Recommendation[],
): string {
  const list = candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.releaseId} | ${c.artist} — ${c.title}` +
        `${c.year ? ` (${c.year})` : ""}` +
        `${c.labels[0] ? ` [${c.labels[0]}]` : ""}` +
        ` | found via: ${c.signals.join("; ")}`,
    )
    .join("\n");

  const top = (items: { name: string; count: number }[], n = 6) =>
    items.slice(0, n).map((i) => `${i.name} (${i.count})`).join(", ") || "—";

  return `A DJ built this playlist from their own record collection. Here is what it is made of, computed from Discogs metadata:

Tracks: ${profile.trackCount} across ${profile.releaseCount} releases
Artists: ${top(profile.artists)}
Labels: ${top(profile.labels)}
Styles: ${top(profile.styles)}
Genres: ${top(profile.genres, 4)}
Countries: ${top(profile.countries, 4)}
Era: ${profile.yearRange ? `${profile.yearRange.from}–${profile.yearRange.to}` : "unknown"}
Decades: ${top(profile.decades, 4)}
Tempo: ${
    profile.bpm.median
      ? `median ${profile.bpm.median} BPM, range ${profile.bpm.min}–${profile.bpm.max} (from ${profile.bpm.known} tracks)`
      : "not catalogued yet"
  }

A graph walk over Discogs (this playlist's artists → their other releases → the labels they appear on → their labelmates) produced these candidate records. Every one is a real Discogs release:

${list}

Do two things.

1. Write a 2–4 sentence characterisation of the playlist. Talk about what actually connects these records — scene, era, production style, the labels involved, how it would function in a set. Write like a knowledgeable record shop employee talking to a DJ, not like ad copy. No bullet points, no headings, no preamble.

2. Rank the candidates by how well they fit, best first. For each, give one short sentence saying specifically why it fits *this* playlist — reference the actual artist, label or era connection. Drop any candidate that genuinely does not belong rather than padding the list.

Return only JSON, no markdown fence:
{"summary": "...", "ranking": [{"releaseId": 12345, "reason": "..."}]}

Use only release ids from the list above. Do not invent records.`;
}

export interface LlmOutcome {
  summary: string | null;
  recommendations: Recommendation[];
  usedLlm: boolean;
  /** Why the LLM pass did not run, when it did not. */
  skipped?: "no_key" | "budget" | "error" | "no_candidates";
}

export async function rankWithClaude(params: {
  userId: string;
  profile: PlaylistProfile;
  candidates: Recommendation[];
}): Promise<LlmOutcome> {
  const { userId, profile, candidates } = params;

  if (!LLM_ENABLED || !env.ANTHROPIC_API_KEY) {
    return { summary: null, recommendations: candidates, usedLlm: false, skipped: "no_key" };
  }
  if (candidates.length === 0) {
    return { summary: null, recommendations: candidates, usedLlm: false, skipped: "no_candidates" };
  }

  // Cost ceiling. Checked before the call, recorded after it.
  const spent = await outputTokensLast24h(userId);
  if (spent >= env.LLM_DAILY_OUTPUT_TOKEN_BUDGET) {
    return { summary: null, recommendations: candidates, usedLlm: false, skipped: "budget" };
  }

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: "user", content: buildPrompt(profile, candidates) },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[llm] ${response.status} from Anthropic API`);
      return { summary: null, recommendations: candidates, usedLlm: false, skipped: "error" };
    }

    const parsedApi = apiResponseSchema.safeParse(await response.json());
    if (!parsedApi.success) {
      return { summary: null, recommendations: candidates, usedLlm: false, skipped: "error" };
    }

    await recordLlmUsage(
      userId,
      parsedApi.data.usage?.input_tokens ?? 0,
      parsedApi.data.usage?.output_tokens ?? 0,
    );

    const text = parsedApi.data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    // Be forgiving about a stray markdown fence, strict about everything else.
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let raw: unknown;
    try {
      raw = JSON.parse(jsonText);
    } catch {
      console.warn("[llm] response was not JSON");
      return { summary: null, recommendations: candidates, usedLlm: false, skipped: "error" };
    }

    const parsed = responseSchema.safeParse(raw);
    if (!parsed.success) {
      return { summary: null, recommendations: candidates, usedLlm: false, skipped: "error" };
    }

    /* ---- the anti-hallucination filter ---- */

    const byId = new Map(candidates.map((c) => [c.releaseId, c]));
    const reordered: Recommendation[] = [];
    const seen = new Set<number>();

    for (const entry of parsed.data.ranking) {
      const candidate = byId.get(entry.releaseId);
      // Not in the request, or named twice: dropped. This is the line that
      // keeps a hallucinated catalogue number out of the UI.
      if (!candidate || seen.has(entry.releaseId)) continue;
      seen.add(entry.releaseId);
      reordered.push({ ...candidate, reason: entry.reason });
    }

    // Anything the model omitted keeps its deterministic position at the end,
    // so a terse response never silently loses records.
    for (const candidate of candidates) {
      if (!seen.has(candidate.releaseId)) reordered.push(candidate);
    }

    return {
      summary: parsed.data.summary.trim() || null,
      recommendations: reordered,
      usedLlm: true,
    };
  } catch (error) {
    console.error("[llm]", error);
    return { summary: null, recommendations: candidates, usedLlm: false, skipped: "error" };
  }
}
