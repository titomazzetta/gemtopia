import "server-only";
import type { NextResponse } from "next/server";
import { getSession, verifyCsrf, type Session } from "./session";
import { resolveSession } from "./repo";
import { fail, forbidden, originAllowed, unauthorized } from "./api";

/**
 * Route guard.
 *
 * Returns either the caller's identity or the response to send instead.
 * Route handlers do `const auth = await requireUser(req); if ("response" in
 * auth) return auth.response;` — one line, impossible to forget, and the
 * `userId` it hands back is the only thing repo functions accept.
 *
 * `mutating: true` additionally enforces the Origin check and the
 * double-submit CSRF token, so a state-changing route cannot be written
 * without them.
 *
 * Three things happen here in a fixed order, and the order matters:
 *   1. the cookie is decrypted and integrity-checked (no database),
 *   2. for a write, Origin and CSRF are verified,
 *   3. the session is checked against the user's current `session_version`.
 *
 * Step 3 is what makes "sign out everywhere" real. It costs no extra round
 * trip: resolving the username into a user id was always a query, and the
 * version comes back in the same row.
 */

export interface Caller {
  session: Session;
  /** Internal user id. Derived from the session, never from client input. */
  userId: string;
  username: string;
}

export async function requireUser(
  request: Request,
  options: { mutating?: boolean } = {},
): Promise<{ response: NextResponse } | Caller> {
  const session = await getSession();
  if (!session) return { response: unauthorized() };

  if (options.mutating) {
    if (!originAllowed(request)) return { response: forbidden() };
    if (!(await verifyCsrf(request))) return { response: forbidden() };
  }

  const userId = await resolveSession(session.u, session.v);
  if (!userId) {
    // Cryptographically valid, but revoked. A distinct code so the client can
    // clear its local state and send the user back to sign in, rather than
    // silently retrying forever.
    return {
      response: fail(
        "session_revoked",
        "This session was signed out. Please sign in again.",
        401,
      ),
    };
  }

  return { session, userId, username: session.u };
}
