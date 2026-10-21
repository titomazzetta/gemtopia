import "server-only";
import { z } from "zod";
import { env, LLM_ENABLED } from "./env";
import { outputTokensLast24h, recordLlmUsage } from "./repo";
import { readFromModel, type SleeveRead } from "./sleeve";
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

const API_URL = `${env.ANTHROPIC_BASE_URL.replace(/\/$/, "")}/v1/messages`;
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
      /** A tool_use block: the answer already parsed, when the call forced a tool. */
      name: z.string().optional(),
      input: z.unknown().optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
    })
    .optional(),
});

/**
 * The API's own one-line reason for a refusal — "invalid x-api-key",
 * "credit balance is too low", an unknown model — for the server log. The
 * type and the message only, cut short; never the request, never the key.
 */
async function errorReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { type?: string; message?: string } };
    const type = body.error?.type ?? "";
    const message = (body.error?.message ?? "").replace(/\s+/g, " ").slice(0, 160);
    return [type, message].filter(Boolean).join(": ") || "no detail";
  } catch {
    return "no detail";
  }
}

/**
 * The JSON in a model's answer.
 *
 * Asked the robust way first: the call names one tool and forces it
 * (`tool_choice`), so the answer arrives as a `tool_use` block whose `input`
 * is already an object the API validated against our schema. Should a model
 * answer in text anyway — a stub, an older model, a refusal to call the tool
 * — the text is tried as JSON: whole, then without a markdown fence, then
 * the first `{` to the last `}`, because a chatty model wraps the object in
 * a sentence. "Not JSON" was once the whole story of a working key that
 * looked broken for an afternoon.
 */
function answerJson(
  content: Array<{ type: string; text?: string; name?: string; input?: unknown }>,
  tool: string,
): unknown {
  const used = content.find((block) => block.type === "tool_use" && block.name === tool);
  if (used && used.input !== undefined) return used.input;
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
  const attempts = [
    text,
    text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim(),
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1),
  ];
  for (const attempt of attempts) {
    if (!attempt) continue;
    try {
      return JSON.parse(attempt);
    } catch {
      /* the next shape */
    }
  }
  return undefined;
}

/** A forced tool: the one shape an answer may take. */
function forcedTool(name: string, description: string, schema: Record<string, unknown>) {
  return {
    tools: [{ name, description, input_schema: schema }],
    tool_choice: { type: "tool", name },
  };
}

const RANK_TOOL = forcedTool("rank", "The playlist's characterisation and the candidates in order.", {
  type: "object",
  properties: {
    summary: { type: "string" },
    ranking: {
      type: "array",
      items: {
        type: "object",
        properties: { releaseId: { type: "integer" }, reason: { type: "string" } },
        required: ["releaseId", "reason"],
      },
    },
  },
  required: ["summary", "ranking"],
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

Answer with the rank tool: summary, then ranking as [{"releaseId": 12345, "reason": "..."}].

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
        ...RANK_TOOL,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[llm] ${response.status} from Anthropic API: ${await errorReason(response)}`);
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

    const raw = answerJson(parsedApi.data.content, "rank");
    if (raw === undefined) {
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

/* ------------------------------------------------------------------ */
/* Reading a sleeve                                                    */
/* ------------------------------------------------------------------ */

/**
 * What the sleeve reader is, and isn't.
 *
 * A photo of a record goes to the model with one job: transcribe what is
 * printed — artist, title, label, catalogue number, barcode digits, year —
 * as JSON. That's all. Which pressing it is, whether you own it, what goes
 * in the set: Discogs and lib/sleeve.ts decide that from the text, so a
 * confident model can't put a record in front of you that doesn't exist.
 *
 * The photo is forwarded once and kept nowhere: not written to disk, not to
 * the database, not logged. The answer is parsed with a strict schema and
 * cleaned like a chat message before it reaches the browser.
 */

const SLEEVE_TIMEOUT_MS = 30_000;
const SLEEVE_MAX_OUTPUT_TOKENS = 300;

export type SleeveMime = "image/jpeg" | "image/png" | "image/webp";

const SLEEVE_TOOL = forcedTool("read", "What is printed on the record, transcribed.", {
  type: "object",
  properties: {
    artist: { type: ["string", "null"] },
    title: { type: ["string", "null"] },
    label: { type: ["string", "null"] },
    catno: { type: ["string", "null"] },
    barcode: { type: ["string", "null"] },
    year: { type: ["integer", "null"] },
    confidence: { type: "number" },
  },
  required: ["artist", "title", "label", "catno", "barcode", "year", "confidence"],
});

const SLEEVE_PROMPT = `This is a photo of a vinyl record: its sleeve, centre label, spine or the barcode on the back.
Transcribe exactly what is printed, with the read tool.
- artist: the main artist as printed (null if not visible)
- title: the record's title as printed (not a track name, unless the record is named after it)
- label: the record label's name
- catno: the catalogue number as printed, e.g. "KDJ 44" or "PF-045" (null if not visible)
- barcode: the digits printed under a barcode, digits only (null if there is no barcode)
- year: a four-digit year if printed, else null
- confidence: 0 to 1, how sure you are of artist and title
Do not guess fields that are not visible; use null. Do not add fields.`;

export type SleeveOutcome =
  | { ok: true; read: SleeveRead; model: string }
  | { ok: false; skipped: "no_key" | "budget" | "error" | "unread" };

/** Whether the deployment can read sleeves at all (an API key is set). */
export const SLEEVE_READER_ENABLED = LLM_ENABLED;
export const SLEEVE_READER_MODEL = env.SLEEVE_READER_MODEL;

export async function readSleeve(params: {
  userId: string;
  imageBase64: string;
  mime: SleeveMime;
}): Promise<SleeveOutcome> {
  const { userId, imageBase64, mime } = params;
  if (!LLM_ENABLED || !env.ANTHROPIC_API_KEY) return { ok: false, skipped: "no_key" };

  const spent = await outputTokensLast24h(userId);
  if (spent >= env.LLM_DAILY_OUTPUT_TOKEN_BUDGET) return { ok: false, skipped: "budget" };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: env.SLEEVE_READER_MODEL,
        max_tokens: SLEEVE_MAX_OUTPUT_TOKENS,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mime, data: imageBase64 } },
              { type: "text", text: SLEEVE_PROMPT },
            ],
          },
        ],
        ...SLEEVE_TOOL,
      }),
      signal: AbortSignal.timeout(SLEEVE_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(`[sleeve] ${response.status} from Anthropic API: ${await errorReason(response)}`);
      return { ok: false, skipped: "error" };
    }
    const parsedApi = apiResponseSchema.safeParse(await response.json());
    if (!parsedApi.success) return { ok: false, skipped: "error" };

    await recordLlmUsage(
      userId,
      parsedApi.data.usage?.input_tokens ?? 0,
      parsedApi.data.usage?.output_tokens ?? 0,
    );

    const raw = answerJson(parsedApi.data.content, "read");
    if (raw === undefined) return { ok: false, skipped: "unread" };
    const read = readFromModel(raw);
    if (!read) return { ok: false, skipped: "unread" };
    return { ok: true, read, model: env.SLEEVE_READER_MODEL };
  } catch (error) {
    console.error("[sleeve]", error instanceof Error ? error.message : error);
    return { ok: false, skipped: "error" };
  }
}
