import "server-only";
import type { NextResponse } from "next/server";
import { getSession, verifyCsrf, type Session } from "./session";
import { ensureUser } from "./repo";
import { forbidden, originAllowed, unauthorized } from "./api";

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

  const userId = await ensureUser(session.u);
  return { session, userId, username: session.u };
}
