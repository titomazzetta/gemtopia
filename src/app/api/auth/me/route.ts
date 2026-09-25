import { cookies } from "next/headers";
import { getSession, CSRF_COOKIE } from "@/lib/session";
import { resolveSession } from "@/lib/repo";
import { json } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Session probe for the client. Returns the username and the CSRF token,
 * and — importantly — never the Discogs access token or its secret.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return json({ authenticated: false as const });
  // A revoked session is not a signed-in one, even though its cookie still
  // decrypts. Saying so here sends the client back to sign in immediately.
  if (!(await resolveSession(session.u, session.v))) {
    return json({ authenticated: false as const });
  }

  const jar = await cookies();
  return json({
    authenticated: true as const,
    username: session.u,
    csrfToken: jar.get(CSRF_COOKIE)?.value ?? "",
  });
}
