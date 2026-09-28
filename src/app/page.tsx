import { cookies } from "next/headers";
import { getSession, CSRF_COOKIE } from "@/lib/session";
import { resolveSession } from "@/lib/repo";
import { SignIn } from "@/components/SignIn";
import { CrateApp } from "@/components/CrateApp";
import { INVITE_ONLY, isAdmin } from "@/lib/invites";

export const dynamic = "force-dynamic";

const AUTH_ERRORS: Record<string, string> = {
  denied: "You cancelled the Discogs authorisation.",
  expired:
    "That sign-in took longer than 10 minutes. Please try again.",
  no_cookie:
    "Your browser didn't send back the sign-in cookie. Finish signing in " +
    "in the same browser you started in, and check that cookies aren't blocked " +
    "for this site.",
  mismatch: "Sign-in could not be verified. Please start again.",
  invalid: "Discogs sent back something we could not read.",
  failed: "Discogs sign-in failed. Please try again.",
  rate_limited: "Too many sign-in attempts. Wait a minute and retry.",
  // The three invite outcomes get their own words and links in SignIn; these
  // are the plain-text fallbacks and what a screen reader hears first.
  not_invited: "Ooh — you're not on the list yet.",
  invite_invalid: "That invite code didn't work.",
  removed: "This account's access to Gemtopia was removed.",
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
  //
  // "Revoked" and "couldn't check" are kept apart. This used to swallow any
  // error into "revoked", so when production was briefly missing a database
  // column every member was told they had signed out of every device — which
  // is untrue, alarming, and sends people to fix the wrong thing.
  let live: string | null = null;
  let unavailable = false;
  if (session) {
    try {
      live = await resolveSession(session.u, session.v);
    } catch (error) {
      console.error("[home] session check failed", error);
      unavailable = true;
    }
  }

  if (unavailable) {
    return (
      <SignIn
        error={
          "Gemtopia can't reach its database right now. You're still signed in, " +
          "and your playlists are safe — try again in a minute."
        }
        inviteOnly={INVITE_ONLY}
      />
    );
  }

  if (!session || !live) {
    const code = typeof params.auth_error === "string" ? params.auth_error : null;
    const message = code
      ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed!)
      : session && !live
        ? "You signed out of every device. Sign in again to carry on."
        : null;
    return <SignIn error={message} errorCode={code} inviteOnly={INVITE_ONLY} />;
  }

  const jar = await cookies();
  return (
    <CrateApp
      username={session.u}
      csrfToken={jar.get(CSRF_COOKIE)?.value ?? ""}
      canInvite={isAdmin(session.u)}
    />
  );
}
