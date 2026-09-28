import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { callerId, rateLimit } from "@/lib/ratelimit";
import {
  MAX_LIVE_INVITES,
  generateInviteCode,
  inviteStatus,
  parseLifetime,
} from "@/lib/invite-code";
import { INVITE_ONLY, inviteHash } from "@/lib/invites";
import { countLiveInvites, createInvite, listInvites, listMembers } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invite codes, admin only. Anyone else gets a 404 (see auth.requireAdmin).
 *
 * GET  — your codes (status only; the codes themselves are unrecoverable) and
 *        everyone with an account.
 * POST — make a code that lives an hour or a day. The response is the only
 *        time the plaintext code exists anywhere: it is hashed before it is
 *        stored, and `no-store` keeps it out of every cache on the way back.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  try {
    const now = Date.now();
    const [invites, members] = await Promise.all([
      listInvites(auth.userId),
      listMembers(),
    ]);
    return json({
      inviteOnly: INVITE_ONLY,
      maxLive: MAX_LIVE_INVITES,
      invites: invites.map((row) => ({ ...row, status: inviteStatus(row, now) })),
      members,
    });
  } catch (error) {
    return handleError("admin/invites/list", error);
  }
}

const createSchema = z.object({ hours: z.number() }).strict();

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // Generous for a person, tight for a script driving a stolen admin session.
  const limit = rateLimit(callerId(request, "invite-create", auth.username), 20, 60 * 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "That's a lot of codes. Try again later.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  let hours: ReturnType<typeof parseLifetime> = null;
  try {
    const parsed = createSchema.safeParse(await request.json());
    hours = parsed.success ? parseLifetime(parsed.data.hours) : null;
  } catch {
    hours = null;
  }
  if (!hours) return fail("bad_request", "A code lives 1 or 24 hours.", 400);

  try {
    if ((await countLiveInvites(auth.userId)) >= MAX_LIVE_INVITES) {
      return fail(
        "too_many_live",
        `You already have ${MAX_LIVE_INVITES} unused codes. Revoke one or let them run out.`,
        409,
      );
    }

    // A collision in 8.5 × 10^11 is not going to happen, but the column is
    // UNIQUE, so if it ever does, draw again rather than 500.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateInviteCode();
      const hash = inviteHash(code);
      if (!hash) throw new Error("generated an unparseable invite code");
      try {
        const created = await createInvite(auth.userId, hash, hours);
        return json({ code, hours, ...created }, { status: 201 });
      } catch (error) {
        if ((error as { code?: string }).code !== "23505") throw error;
      }
    }
    throw new Error("invite code collided three times");
  } catch (error) {
    return handleError("admin/invites/create", error);
  }
}
