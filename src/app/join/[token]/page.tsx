import { cookies } from "next/headers";
import Link from "next/link";
import { getSession, CSRF_COOKIE } from "@/lib/session";
import { previewJoin, resolveSession } from "@/lib/repo";
import { isJoinToken } from "@/lib/collab";
import { INVITE_ONLY } from "@/lib/invites";
import { SignIn } from "@/components/SignIn";
import { JoinCard } from "@/components/JoinCard";
import { Mark } from "@/components/Mark";

export const dynamic = "force-dynamic";

/**
 * Where a collaboration link lands.
 *
 * Signed out: the normal sign-in page, with a line saying why you're here,
 * and sign-in brings you straight back to this link. The playlist's name is
 * not shown yet — the link is for members, and it says nothing to anyone
 * else.
 *
 * Signed in: what you're joining, and a Join button. Nothing happens until
 * that button is pressed.
 */
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = isJoinToken(token);
  const next = valid ? `/join/${token}` : undefined;

  const session = await getSession();
  const userId = session
    ? await resolveSession(session.u, session.v).catch(() => null)
    : null;

  if (!session || !userId) {
    return (
      <SignIn
        error={null}
        inviteOnly={INVITE_ONLY}
        next={next}
        notice="You've been asked to help build a playlist on Gemtopia. Sign in with Discogs and you'll come straight back here to join it."
      />
    );
  }

  const preview = valid ? await previewJoin(userId, token).catch(() => null) : null;
  const jar = await cookies();

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <Mark size={40} className="text-accent" />
        <span className="text-lg font-semibold tracking-tight text-neutral-100">Gemtopia</span>
      </div>
      {preview ? (
        <JoinCard
          token={token}
          csrfToken={jar.get(CSRF_COOKIE)?.value ?? ""}
          preview={preview}
        />
      ) : (
        <div className="rounded-xl border border-ink-700 bg-ink-900 p-5">
          <h1 className="text-base font-semibold text-neutral-100">This link isn&rsquo;t active</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            It may have been turned off or replaced with a new one. Ask whoever
            sent it for a fresh link.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex rounded-md border border-ink-700 px-3 py-2 text-sm text-neutral-200 hover:border-accent/50 hover:text-accent"
          >
            Go to your crate
          </Link>
        </div>
      )}
    </main>
  );
}
