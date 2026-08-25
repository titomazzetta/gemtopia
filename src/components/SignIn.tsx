import { Disc } from "./Icons";

const FEATURES = [
  ["Shuffle the crate", "Fisher–Yates across every clip Discogs has for your collection, spread so the same release never lands back to back."],
  ["Filter, then shuffle", "Cut to a style, a label, a year range — then shuffle what's left. Rebuild the pool in a couple of clicks mid-set."],
  ["Playlists on the fly", "Hit A while something is playing. Reorder by drag, play in order or shuffled, export as JSON."],
  ["Wantlist too", "Same flow against your wantlist, for when you are auditioning rather than digging."],
];

export function SignIn({ error }: { error: string | null }) {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <Disc className="h-8 w-8 text-accent" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-100">
            Playtopia
          </h1>
          <p className="text-xs text-neutral-500">
            A Bandcamp-style player for your Discogs crate.
          </p>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <a
        href="/api/auth/login"
        className="mb-8 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 transition-transform hover:scale-[1.02]"
      >
        Sign in with Discogs
      </a>

      <dl className="grid gap-5 sm:grid-cols-2">
        {FEATURES.map(([title, body]) => (
          <div key={title}>
            <dt className="text-sm font-medium text-neutral-200">{title}</dt>
            <dd className="mt-1 text-xs leading-relaxed text-neutral-500">{body}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-10 space-y-3 border-t border-ink-800 pt-6 text-xs leading-relaxed text-neutral-500">
        <p>
          <strong className="font-medium text-neutral-400">
            Where the audio comes from.
          </strong>{" "}
          Discogs stores YouTube links against releases, and that is what plays
          here. YouTube&rsquo;s API terms require the player stay visible at a
          minimum size, so it sits in the corner doing the job album art would —
          every control you use is this app&rsquo;s. Nothing is downloaded or
          re-hosted.
        </p>
        <p>
          <strong className="font-medium text-neutral-400">
            What this app stores.
          </strong>{" "}
          Your Discogs token lives in an encrypted, HttpOnly cookie and nowhere
          else. Your collection index and playlists are cached in your own
          browser. There is no server-side database — logging out and clearing
          site data removes everything.
        </p>
      </section>
    </main>
  );
}
