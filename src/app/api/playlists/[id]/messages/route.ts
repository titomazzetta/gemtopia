import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { listMessages, markChatRead, postMessage } from "@/lib/repo";
import { MAX_MESSAGE_CHARS, isMessageId, normaliseMessage } from "@/lib/chat";
import { UUID } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/*
 * Chat on a collaborative playlist.
 *
 * GET  — the latest page of messages, or the page before ?before=<id>.
 * POST — { body } posts a message.
 *
 * Who may: the owner and collaborators, decided in the SQL (repo.ts), never
 * here. Anyone else — a stranger, someone removed a second ago, a malformed
 * id — gets one indistinguishable 404, the same as for the playlist itself.
 */

/** Far more than 500 characters of anything could need, even as JSON escapes. */
const MAX_BODY_BYTES = 16 * 1024;

const postSchema = z
  .object({ body: z.string().max(MAX_BODY_BYTES) })
  .strict();

const readSchema = z.object({ readUpTo: z.string().refine(isMessageId) }).strict();

/**
 * PUT — { readUpTo } marks the chat read up to that message, so the unread
 * badge clears on every device. Moves forward only; see repo.markChatRead.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "playlist-chat-read-mark", auth.username), 60, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, { retryAfter: limit.resetSeconds });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) return fail("not_found", "No such playlist.", 404);

  const parsed = readSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("bad_request", "Expected { readUpTo }.", 400);

  try {
    const ok = await markChatRead(auth.userId, id, parsed.data.readUpTo);
    if (!ok) return fail("not_found", "No such playlist.", 404);
    return json({ ok: true });
  } catch (error) {
    return handleError("playlists/messages/read", error);
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  // Polling every few seconds while the chat is open is ~15 a minute; this
  // leaves room for two tabs and paging back, and not much more.
  const limit = rateLimit(callerId(request, "playlist-chat-read", auth.username), 90, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Slow down a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) return fail("not_found", "No such playlist.", 404);

  const before = request.nextUrl.searchParams.get("before");
  if (before !== null && !isMessageId(before)) {
    return fail("bad_request", "Invalid cursor.", 400);
  }

  try {
    const page = await listMessages(auth.userId, id, before);
    if (!page) return fail("not_found", "No such playlist.", 404);
    return json(page);
  } catch (error) {
    return handleError("playlists/messages/list", error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // The in-memory limit is the fast first line; repo.postMessage also counts
  // in the database, which holds across instances.
  const limit = rateLimit(callerId(request, "playlist-chat-post", auth.username), 10, 30_000);
  if (!limit.ok) {
    return fail("rate_limited", "You're sending messages quickly — give it a few seconds.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  const { id } = await params;
  if (!UUID.safeParse(id).success) return fail("not_found", "No such playlist.", 404);

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return fail("too_large", "That message is too long.", 413);

  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("bad_request", "Expected { body }.", 400);

  const message = normaliseMessage(parsed.data.body);
  if (!message.ok) {
    return message.reason === "empty"
      ? fail("empty", "Type a message first.", 400)
      : fail("too_long", `Messages can be up to ${MAX_MESSAGE_CHARS} characters.`, 400);
  }

  try {
    const result = await postMessage(auth.userId, id, message.body);
    if (result.status === "not_found") return fail("not_found", "No such playlist.", 404);
    if (result.status === "too_fast") {
      return fail("rate_limited", "You're sending messages quickly — give it a few seconds.", 429, {
        retryAfter: 30,
      });
    }
    return json({ message: result.message }, { status: 201 });
  } catch (error) {
    return handleError("playlists/messages/post", error);
  }
}
