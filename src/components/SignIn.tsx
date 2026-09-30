import { Mark } from "@/components/Mark";

const FEATURES = [
  ["Shuffle the crate", "Fisher–Yates across every clip Discogs has for your collection, spread so the same release never lands back to back."],
  ["Filter, then shuffle", "Style, label, artist, country, decade, tempo — every option counted from your own records. Cut the crate down, then shuffle what's left."],
  ["Playlists on the fly", "Tap + (or A) while something plays. Reorder by drag, view by artist, genre, BPM or year, play in order or shuffled. Private to you — or build one together with collaborators you invite."],
  ["Know it'll beatmatch", "Tap the BPM in as you listen, or let it detect. Every transition in a playlist checked against your decks' pitch range."],
  ["Dig from anything", "Dig from any record (D on a keyboard): the whole EP, everything you own that connects to it, and the versions, remixers and labels you don't own yet."],
  ["Both lists, both ways", "Shuffle the wantlist like a crate. Search Discogs for a record that just arrived and put it in your collection. Adding is the only thing this app writes."],
];

/** Who to ask for a code. The app is one person's for now, and says so. */
const CONTACT = "titomazzetta";
const CONTACT_LINKS = [
  ["Discogs", `https://www.discogs.com/user/${CONTACT}`],
  ["GitHub", `https://github.com/${CONTACT}`],
] as const;

const INVITE_ERRORS = new Set(["not_invited", "invite_invalid", "removed"]);

function AskForCode() {
  return (
    <>
      DM <span className="font-medium text-neutral-100">{CONTACT}</span> on{" "}
      {CONTACT_LINKS.map(([name, href], i) => (
        <span key={name}>
          {i > 0 && " or "}
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline decoration-dotted underline-offset-2"
          >
            {name}
          </a>
        </span>
      ))}
    </>
  );
}

/** The invite outcomes deserve more than a red line: they say what to do next. */
function InviteNotice({ code }: { code: string }) {
  if (code === "not_invited") {
    return (
      <div role="alert" className="mb-6 rounded-md border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-neutral-300">
        <p className="font-medium text-neutral-100">Ooh — you&rsquo;re not on the list yet.</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          Gemtopia is invite-only while it&rsquo;s small. <AskForCode /> for a code, then
          enter it below. Nothing from your Discogs account was kept.
        </p>
      </div>
    );
  }
  if (code === "invite_invalid") {
    return (
      <div role="alert" className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
        <p className="font-medium">That invite code didn&rsquo;t work.</p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          Each code works once, for an hour or a day. Check it for typos — or <AskForCode /> for a
          fresh one.
        </p>
      </div>
    );
  }
  return (
    <div role="alert" className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <p className="font-medium">This account&rsquo;s access to Gemtopia was removed.</p>
      <p className="mt-1 text-xs leading-relaxed text-neutral-400">
        If that&rsquo;s a mistake, <AskForCode />.
      </p>
    </div>
  );
}

export function SignIn({
  error,
  errorCode = null,
  inviteOnly = false,
  next,
  notice,
}: {
  error: string | null;
  errorCode?: string | null;
  inviteOnly?: boolean;
  /** A join link to come back to after signing in. Validated server-side. */
  next?: string;
  /** A line above the button explaining why they're here (e.g. a join link). */
  notice?: string;
}) {
  const loginHref = next ? `/api/auth/login?next=${encodeURIComponent(next)}` : "/api/auth/login";
  const inviteError = errorCode !== null && INVITE_ERRORS.has(errorCode);
  const showCodeField = inviteOnly || inviteError;
  const openCodeField = errorCode === "not_invited" || errorCode === "invite_invalid";

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
      <div className="mb-8 flex items-center gap-3">
        {/* Forced to the display cut: 64 would pick it anyway, and stating it
            here means a later size tweak cannot silently downgrade the one
            screen with room for the nine-facet drawing. */}
        <Mark size={64} cut="display" className="text-accent" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-neutral-100">
            Gemtopia
          </h1>
          <p className="text-xs text-neutral-500">
            For the storytelling DJ. Dig your records, shape the set, tell the story.
          </p>
        </div>
      </div>

      {inviteError && errorCode ? (
        <InviteNotice code={errorCode} />
      ) : error && (
        <p
          role="alert"
          className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      {notice && (
        <p className="mb-4 rounded-md border border-accent-alt/40 bg-accent-alt/10 px-3 py-2 text-sm text-neutral-200">
          {notice}
        </p>
      )}

      <a
        href={loginHref}
        className="mb-8 inline-flex items-center justify-center rounded-md bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 transition-transform hover:scale-[1.02]"
      >
        Sign in with Discogs
      </a>

      {showCodeField && (
        <details open={openCodeField} className="group -mt-5 mb-8">
          <summary className="cursor-pointer list-none text-center text-xs text-neutral-500 hover:text-neutral-300">
            {inviteOnly ? "Invite-only for now. " : ""}
            <span className="underline decoration-dotted underline-offset-2">Have an invite code?</span>
          </summary>
          {/*
            A real form POST, not a link: the code travels in the request body,
            so it never lands in the address bar, history, or a server log.
            Works with JavaScript off.
          */}
          <form method="post" action="/api/auth/login" className="mt-3 flex gap-2">
            {next && <input type="hidden" name="next" value={next} />}
            <label htmlFor="invite-code" className="sr-only">
              Invite code
            </label>
            <input
              id="invite-code"
              name="code"
              required
              maxLength={32}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="XXXX-XXXX"
              className="h-11 min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-900 px-3 text-center font-mono text-base uppercase tracking-[0.2em] text-neutral-100 placeholder:text-neutral-700 focus:border-accent/60 focus:outline-none"
            />
            <button
              type="submit"
              className="h-11 shrink-0 rounded-md border border-accent/60 px-4 text-sm font-semibold text-accent hover:bg-accent/10"
            >
              Use code
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] text-neutral-600">
            You&rsquo;ll sign in with Discogs next. Already a member? You don&rsquo;t need one.
          </p>
        </details>
      )}

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
          are private: no route serves them to anyone but you and the
          collaborators you choose to let in.
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
