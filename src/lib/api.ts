import "server-only";
import { NextResponse } from "next/server";
import { DiscogsError } from "./discogs";
import { env } from "./env";

/**
 * Uniform JSON responses and a single place where errors become HTTP.
 *
 * The rule enforced here: internal failure detail goes to the server log,
 * never to the client. The browser sees a stable code and a sentence safe to
 * render. This kills a whole class of information-disclosure bugs where a
 * stack trace or upstream error body leaks into a UI toast.
 */

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

export function fail(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): NextResponse {
  return json({ error: { code, message, ...extra } }, { status });
}

export const unauthorized = () =>
  fail("unauthenticated", "Sign in with Discogs to continue.", 401);

export const forbidden = () =>
  fail("csrf", "Request rejected. Refresh the page and try again.", 403);

/** Convert any thrown value into a safe response. */
export function handleError(scope: string, error: unknown): NextResponse {
  if (error instanceof DiscogsError) {
    if (error.status === 429) {
      return fail(
        "rate_limited",
        "Discogs is rate limiting us. Syncing will resume automatically.",
        429,
        { retryAfter: error.retryAfterSeconds ?? 60 },
      );
    }
    if (error.status === 401) {
      return fail(
        "discogs_unauthorized",
        "Your Discogs authorisation expired. Please sign in again.",
        401,
      );
    }
    if (error.status === 404) {
      return fail("not_found", "That release is not on Discogs.", 404);
    }
    console.error(`[${scope}] discogs error ${error.status}: ${error.message}`);
    return fail("upstream", "Discogs could not be reached right now.", 502);
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return fail("timeout", "Discogs took too long to respond.", 504);
  }

  // Unknown: log fully server-side, tell the client nothing.
  console.error(`[${scope}] unhandled`, error);
  return fail(
    "internal",
    "Something went wrong on our side.",
    500,
    env.NODE_ENV === "development"
      ? { detail: error instanceof Error ? error.message : String(error) }
      : {},
  );
}

/**
 * Reject requests whose Origin header does not match our canonical origin.
 * Cheap defence-in-depth alongside SameSite cookies and the CSRF token.
 */
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // same-origin GETs and non-browser clients
  try {
    return new URL(origin).origin === new URL(env.APP_ORIGIN).origin;
  } catch {
    return false;
  }
}
