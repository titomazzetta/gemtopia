import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { fail, handleError, json } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { readSleeve, SLEEVE_READER_ENABLED, type SleeveMime } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read a photographed sleeve: the one route in the app that takes an image.
 *
 * What it does with the image, in full: checks it is a small JPEG, PNG or
 * WebP (by size and by its first bytes, not by what the request says it
 * is), forwards it once to the model (lib/llm.ts readSleeve), and returns
 * the text the model read — artist, title, label, catalogue number, barcode.
 * The image is not written to disk, not stored in the database, not logged,
 * and the browser already stripped its metadata by re-encoding it
 * (client/sleeveImage.ts), so no location or device data arrives here.
 *
 * Why the limits are what they are: the browser sends at most ~1,600px on
 * the long side as JPEG, which is under 600 KB; the ceiling here is a bit
 * above that so a phone that sends a touch more still works, and a request
 * padded to the limit can't cost more than one model call. Twenty a minute
 * is faster than anyone can photograph records.
 */
const MAX_IMAGE_BYTES = 900_000;
const MAX_BASE64_CHARS = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8;

const bodySchema = z
  .object({
    mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
    // Standard base64 only: no data: prefix, no URL alphabet, no whitespace.
    image: z
      .string()
      .min(64)
      .max(MAX_BASE64_CHARS)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "not base64"),
  })
  .strict();

/** The image's first bytes say what it is; the request only claims. */
function sniff(head: Buffer): SleeveMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireUser(request, { mutating: true });
  if ("response" in auth) return auth.response;

  // Twenty a minute: a stack of photos read one after another, with the
  // model taking a few seconds each, lands well under it; a loop doesn't.
  const limit = rateLimit(`scan:${auth.username}`, 20, 60_000);
  if (!limit.ok) {
    return fail("rate_limited", "One sleeve at a time — give it a moment.", 429, {
      retryAfter: limit.resetSeconds,
    });
  }

  if (!SLEEVE_READER_ENABLED) {
    return fail("not_configured", "Reading sleeves isn't set up on this deployment.", 503);
  }

  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail("bad_request", "Send one JPEG, PNG or WebP under 900 KB.", 400);

    const head = Buffer.from(parsed.data.image.slice(0, 32), "base64");
    const actual = sniff(head);
    if (actual === null || actual !== parsed.data.mime) {
      return fail("bad_request", "That doesn't look like a JPEG, PNG or WebP.", 400);
    }

    const outcome = await readSleeve({
      userId: auth.userId,
      imageBase64: parsed.data.image,
      mime: actual,
    });
    if (!outcome.ok) {
      switch (outcome.skipped) {
        case "no_key":
          return fail("not_configured", "Reading sleeves isn't set up on this deployment.", 503);
        case "budget":
          return fail("budget", "You've read a lot of sleeves today — try again tomorrow.", 429);
        case "unread":
          return json({ read: null });
        default:
          return fail("upstream", "Couldn't read that photo just now. Try again.", 502);
      }
    }
    return json({ read: outcome.read, model: outcome.model });
  } catch (error) {
    return handleError("scan", error);
  }
}
