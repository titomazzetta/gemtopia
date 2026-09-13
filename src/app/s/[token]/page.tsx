import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlaylistByShareToken } from "@/lib/repo";
import { Disc } from "@/components/Icons";
import { SharedPlayer } from "@/components/SharedPlayer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The shared set list.
 *
 * Deliberately not the app: whoever opens this has a link, not an account, and
 * should get the set list without a sign-in wall, without a sync, and without
 * anything that could touch the owner's Discogs account.
 *
 * The one interactive part is the player, and it is interactive without being
 * *connected*: every track is rendered into the page by the server, and
 * `SharedPlayer` makes no request back to Gemtopia at all. So there is still
 * no session here, no CSRF token, and no write path — not hidden behind a
 * check, but absent.
 *
 * One thing an audit turns up and it is worth writing down rather than
 * explaining twice: the token appears in the RSC flight payload embedded in
 * this page, because Next serialises the route params it rendered with. That
 * is not a leak. The token is in the address bar of the person reading it —
 * they hold the credential already, and a credential echoed back to its own
 * holder discloses nothing. What would matter is the token reaching a *third*
 * party, and it does not: `Referrer-Policy: no-referrer` is set globally, so
 * the URL never travels in a header to YouTube or to the Discogs links below,
 * and a browser audit of this page confirms the only third-party host it
 * contacts at all is youtube.com.
 */

export const metadata: Metadata = {
  // A share link is private-by-obscurity: the token is the credential. Search
  // engines must never index one, or "unlisted" quietly becomes "public".
  robots: { index: false, follow: false, nocache: true },
  title: "A set on Gemtopia",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function SharedPlaylistPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const playlist = await getPlaylistByShareToken(token);

  // Unknown, malformed and revoked all land here identically.
  if (!playlist) notFound();

  return (
    <main className="mx-auto min-h-full max-w-2xl px-6 py-12">
      <header className="mb-8">
        <div className="mb-5 flex items-center gap-2 text-neutral-600">
          <Disc className="h-4 w-4" />
          <span className="text-[11px] uppercase tracking-wider">Gemtopia</span>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">
          {playlist.name}
        </h1>

        <p className="mt-1.5 text-xs text-neutral-600">
          {playlist.items.length} track{playlist.items.length === 1 ? "" : "s"}
          {" · shared "}
          {formatWhen(playlist.sharedAt)}
        </p>

        {playlist.notes && (
          <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-neutral-400">
            {playlist.notes}
          </p>
        )}
      </header>

      {playlist.items.length > 0 && (
        <SharedPlayer
          tracks={playlist.items.map((item) => ({
            clipKey: item.clipKey,
            videoId: item.videoId,
            releaseId: item.releaseId,
            title: item.title,
            artist: item.artist,
            releaseTitle: item.releaseTitle,
            year: item.year,
          }))}
        />
      )}

      <ol className="divide-y divide-ink-800 border-y border-ink-800">
        {playlist.items.map((item, index) => (
          <li key={item.clipKey} className="flex items-baseline gap-3 py-2.5">
            <span className="w-6 shrink-0 text-right font-mono text-[11px] tabular-nums text-neutral-700">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-neutral-200">
                {item.title}
              </span>
              <span className="block truncate text-[11px] text-neutral-500">
                {item.artist}
                <span className="text-neutral-700"> — {item.releaseTitle}</span>
                {item.year ? (
                  <span className="text-neutral-700"> · {item.year}</span>
                ) : null}
              </span>
            </span>
            {/*
              A link out to the record on Discogs, so someone reading the set
              can go and find it. rel="noreferrer" so Discogs is not told which
              share token the visitor came from — the token is a credential and
              must not travel in a Referer header.
            */}
            <a
              href={`https://www.discogs.com/release/${item.releaseId}`}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-[10px] text-neutral-700 hover:text-accent"
            >
              Discogs ↗
            </a>
          </li>
        ))}
      </ol>

      {/*
        The invitation. Someone reading a shared set list is, almost by
        definition, a DJ looking at another DJ's records — which makes this the
        one place where a pitch is welcome rather than an interruption. It sits
        below the music, never above it.
      */}
      <section className="mt-10 rounded-lg border border-ink-800 bg-ink-900 p-5">
        <h2 className="text-sm font-semibold text-neutral-100">
          Do you dig?
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-neutral-400">
          If you play records, you already know the problem: the crate only
          works when you&rsquo;re standing in front of it. Everywhere else your
          collection is a list of things you own and can&rsquo;t hear.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
          Gemtopia plays your own Discogs collection back to you — on a train,
          in a hotel, the week before the gig. Shuffle it, cut it down to a
          label or a style or a tempo, build the set as you go, and find out
          whether the records will <em>actually beatmatch</em> at your deck&rsquo;s
          pitch range before you pack the bag. And when you hit a record and
          think <em>I want more of this</em>, it digs — through what you own,
          and then through what you don&rsquo;t.
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-neutral-400">
          Your collection, without the noise.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-accent px-3.5 py-2 text-[13px] font-semibold text-ink-950 transition-transform hover:scale-[1.02]"
        >
          Open your own crate
        </Link>
        <p className="mt-2.5 text-[11px] text-neutral-600">
          Sign in with Discogs. Free, and the only thing it ever writes to
          your account is a record you pressed add on.
        </p>
      </section>

      <footer className="mt-8 space-y-2 text-[11px] leading-relaxed text-neutral-600">
        <p>
          <strong className="font-medium text-neutral-500">
            What this link can and cannot reach.
          </strong>{" "}
          It reaches this one set list. It cannot reach the person who made it,
          their Discogs account, their collection, their wantlist, or any other
          playlist they own — not because those are hidden behind a check, but
          because no route from this page leads to them.
        </p>
        <p>
          This page makes no authenticated requests. The tracks were rendered
          into it by the server; the only thing your browser talks to from here
          is YouTube, for the audio.
        </p>
        <p>
          Whoever shared this can revoke the link at any time, which kills it
          permanently rather than pausing it.
        </p>
      </footer>
    </main>
  );
}
