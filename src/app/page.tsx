import { cookies } from "next/headers";
import { getSession, CSRF_COOKIE } from "@/lib/session";
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

  if (!session) {
    const code = typeof params.auth_error === "string" ? params.auth_error : null;
    return <SignIn error={code ? (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed!) : null} />;
  }

  const jar = await cookies();
  return (
    <CrateApp
      username={session.u}
      csrfToken={jar.get(CSRF_COOKIE)?.value ?? ""}
    />
  );
}
