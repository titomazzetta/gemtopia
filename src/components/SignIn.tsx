import { Disc } from "./Icons";

const FEATURES = [
  ["Shuffle the crate", "Fisher–Yates across every clip Discogs has for your collection, spread so the same release never lands back to back."],
  ["Filter, then shuffle", "Style, label, artist, country, decade, tempo — every option counted from your own records. Cut the crate down, then shuffle what's left."],
  ["Playlists on the fly", "Hit A while something is playing. Reorder by drag, play in order or shuffled. Private to your account."],
  ["Know it'll beatmatch", "Tap the BPM in as you listen, or let it detect. Every transition in a playlist checked against your decks' pitch range."],
  ["Dig from anything", "Press D on a record for its full metadata, everything else you own that connects to it, and records you don't own yet."],
  ["Both lists, both ways", "Shuffle the wantlist like a crate. Search Discogs for a record that just arrived and put it in your collection. Adding is the only thing this app writes."],
];

export function SignIn({ error }: { error: string | null }) {
  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        <Disc className="h-8 w-8 text-accent" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-100">
            Gemtopia
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
          else — never in a database. Your collection index stays in this
          browser and is never uploaded. Playlists and your BPM catalogue are
          stored against your account so they follow you between devices; they
          are private, and no route serves them to anyone but you.
        </p>
        <p>
          <strong className="font-medium text-neutral-400">
            What it does on your behalf.
          </strong>{" "}
          It reads your collection and wantlist, and only writes when you
          press something. The heart puts a record on your wantlist, and
          pressing it again takes it off. <em>Add</em> on a Discogs search
          result puts that one record in your collection — and nothing here can
          take it back out, on purpose: there is no remove-from-collection
          anywhere in this app, so no button, no bug and no crafted request can
          reach one. It never posts, comments, or lists anything for sale.
        </p>
      </section>
    </main>
  );
}
