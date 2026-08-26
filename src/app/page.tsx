import { cookies } from "next/headers";
import { getSession, CSRF_COOKIE } from "@/lib/session";
import { resolveSession } from "@/lib/repo";
import { SignIn } from "@/components/SignIn";
import { CrateApp } from "@/components/CrateApp";

export const dynamic = "force-dynamic";

const AUTH_ERRORS: Record<string, string> = {
  denied: "You cancelled the Discogs authorisation.",
  expired: "That sign-in link timed out. Please try again.",
  mismatch: "Sign-in could not be verified. Please start again.",
  invalid: "Discogs sent back something we could not read.",
  failed: "Discogs sign-in failed. Please try again.",
  rate_limited: "Too many sign-in attempts. Wait a minute and retry.",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  const params = await searchParams;

  // The API routes reject a revoked session on their own, so the app would be
  // inert anyway — but rendering the shell for someone who has signed out
  // everywhere is a confusing lie. Check here too.
  const live = session
    ? await resolveSession(session.u, session.v).catch(() => null)
    : null;

  if (!session || !live) {
    const code = typeof params.auth_error === "string" ? params.auth_error : null;
    const message = code
      ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed!)
      : session && !live
        ? "You signed out of every device. Sign in again to carry on."
        : null;
    return <SignIn error={message} />;
  }

  const jar = await cookies();
  return (
    <CrateApp
      username={session.u}
      csrfToken={jar.get(CSRF_COOKIE)?.value ?? ""}
    />
  );
}
