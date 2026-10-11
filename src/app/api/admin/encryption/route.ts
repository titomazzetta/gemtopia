import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import { ChatKeyMissingError } from "@/lib/chatKeys";
import { encryptionStatus, rewrapChatKeys, sealOlderMessages } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Chat encryption, admin only. Anyone else gets a 404 (see auth.requireAdmin).
 *
 * GET  — status: is a master key configured, its public id, how many
 *        messages are sealed vs still plaintext from before encryption, how
 *        many playlist keys are wrapped under the current / a retired /
 *        an unconfigured master key, and whether the database itself now
 *        refuses plaintext.
 * POST — { action: "seal-older" } seals pre-encryption messages in place;
 *        { action: "rewrap" } re-wraps playlist keys under the current master
 *        key after a rotation.
 *
 * Nothing here returns key material or message content: ids and counts only.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    return json(await encryptionStatus());
  } catch (error) {
    return handleError("admin/encryption/status", error);
  }
}

const actionSchema = z.object({ action: z.enum(["seal-older", "rewrap"]) }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request, { mutating: true });
  if ("response" in auth) return auth.response;

  const limit = rateLimit(callerId(request, "admin-encryption", auth.username), 30, 10 * 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "Give it a minute.", 429, { retryAfter: limit.resetSeconds });
  }

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("bad_request", 'Expected { action: "seal-older" | "rewrap" }.', 400);

  try {
    const result =
      parsed.data.action === "seal-older" ? await sealOlderMessages() : await rewrapChatKeys();
    return json({ result, status: await encryptionStatus() });
  } catch (error) {
    if (error instanceof ChatKeyMissingError) {
      return fail("unavailable", "CHAT_MASTER_KEY is not set on this deployment.", 503);
    }
    return handleError("admin/encryption/action", error);
  }
}
