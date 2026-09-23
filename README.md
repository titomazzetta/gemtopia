<div align="center">

# Gemtopia

**A crate-digging app for vinyl DJs, built by one.**

[![CI](https://github.com/titomazzetta/gemtopia/actions/workflows/ci.yml/badge.svg)](https://github.com/titomazzetta/gemtopia/actions/workflows/ci.yml)
[![Threat model](https://img.shields.io/badge/threat%20model-documented-4ade80)](./THREAT_MODEL.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

## Who this is for

**Vinyl DJs, away from the decks.**

I play records, and the problem I kept having is that the crate is the instrument —
you can only really play it standing in front of it. Everywhere else your
collection is just an inventory: a list of things you own and can't hear. Meanwhile
the useful thinking always happens exactly where the records aren't. On a train. In
a hotel the night before. Three weeks out from a gig, when you know roughly what
you want the set to feel like and can't audition a single record to find it.

So I built the thing I wanted. Gemtopia turns your Discogs collection into
something you can **hear, sort, sequence and argue with from your phone** — so the
set is half-built before you get home, and pulling the records is twenty minutes of
picking instead of an evening of rediscovery.

Two things I use it for constantly:

### Prep a set on the road

Shuffle your own records and actually listen. Cut the crate to a style, a label, a
decade, a tempo. Build the playlist as you go. Tap the BPMs in while they play —
and get told, before you pack the bag, whether the records in that order will
**actually beatmatch on your decks**, at your pitch range, with the exact fader
move each transition needs.

### Fall down a hole from a record you already own

This is the part that surprised me. When you're going through your own collection,
you keep bumping into a record and thinking *"I want more of this."* Normally that
thought dies there, because you're not near a shop and you can't remember the
label.

Press `D` and it doesn't die. You get everything else **you already own** that
connects to that record — same artist, same label, same style, same year, same
mixable tempo — instantly, no network. And then, one click further, **everything
that exists beyond your collection**: the rest of that artist's discography, the
rest of that label's catalogue, records from the same scene and the same three
years. Preview the audio without owning them. Heart the ones you want. Dig again
from *those*, and keep going.

So a collection stops being a closed box. **The records you own become the map for
finding the ones you don't** — which is what digging in a shop feels like, and what
browsing a database usually doesn't.

---

It runs on the Discogs API, it's meant to be used on trains and in hotel rooms,
and I wrote it to be read as well as run. If you're here for the code rather than
the records, the [threat model](./THREAT_MODEL.md) is the part I'd point at
first — it says what's defended, how, and what deliberately isn't.

---

## Contents

- [Who this is for](#who-this-is-for)
- [What it does](#what-it-does)
- [The digging model](#the-digging-model)
- [BPM, and how it actually works](#bpm-and-how-it-actually-works)
- [Set prep: will these records actually mix?](#set-prep-will-these-records-actually-mix)
- [Where the data comes from](#where-the-data-comes-from)
- [Privacy](#privacy)
- [Deploy it](#deploy-it) — full walkthrough in [DEPLOYING.md](./DEPLOYING.md)
- [How a change reaches production](#how-a-change-reaches-production) — branch rules, CI gates, supply chain
- [Architecture](#architecture)
- [Testing](#testing)
- [Known limits](#known-limits)

---

## What it does

| | |
|---|---|
| **Shuffle the crate** | Fisher–Yates over every clip Discogs has for your collection, spread so the same release never lands twice in a row. |
| **Filter on real metadata** | Style, genre, label, artist, format, country, decade, year and tempo — every option counted from *your* synced collection. Multi-select is **any** or **all**, so you can ask for Techno *or* Deep House, or for the shelf tagged both. |
| **Works on a phone** | Sheets rather than stacked panels: source and playlists in one, filters in another, the player in a third. Transport and TAP sit in a sticky bottom bar at thumb height. |
| **Sort the crate** | Click a column: title, artist, label, year, BPM, length. Ascending, descending, then back to shuffle order. Unmeasured tempos always sink, in both directions. |
| **Dig from anything** | Hit `D` on whatever's playing and pivot on any field. Two lanes: what else you own, and what exists beyond it. |
| **Playlists that follow you** | Stored against your Discogs account. Private by default, always. Drag to reorder, play in order or shuffled. |
| **BPM catalogue** | Detect tempo from the audio as it plays, or tap it in. **Measure** plays through everything on screen and measures it unattended, skipping what is already done. Filter by range, or by what mixes with what's playing. |
| **Set prep** | Every transition in a playlist checked against your decks' pitch range. Flags the ones that won't beatmatch before you pack the bag. |
| **Share a find** | A share icon on every row and in the player. Sends the Discogs release page — not a Gemtopia link — because the friend you're sending it to probably doesn't have an account here. Native share sheet on a phone, clipboard on desktop. |
| **Wantlist, both ways** | Shuffle your wantlist like a crate, and add to it from anywhere in the app — it writes to your real Discogs wantlist. |
| **Search Discogs and add** | The record arrived in the post: search by artist, title, **track name**, catalogue number or barcode, and put it in your collection or wantlist without leaving the app. Every result says whether you already own it. What you add is playable immediately, not after the next sync. |
| **Newest first, by default** | Your collection and wantlist both open in the order you added to them, newest at the top — the same way Discogs presents them. No button to press and nothing to keep in sync: the dates come off the collection and wantlist endpoints, which we already read. Sortable both ways as an **Added** column. |
| **Nothing is hidden from you** | Records with no preview on Discogs still appear in the crate, dimmed and marked, instead of silently not existing. The header splits the count: what plays, what Discogs has no audio for, and what hasn't finished syncing — the last of which is a button. |
| **Playlist dissection** | What a playlist is made of, and what to dig for next, from Discogs' artist and label graph. |

### Keyboard

| Key | Action | | Key | Action |
|---|---|---|---|---|
| <kbd>Space</kbd> | Play / pause | | <kbd>T</kbd> | Tap tempo |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next | | <kbd>D</kbd> | Dig from this record |
| <kbd>J</kbd> <kbd>L</kbd> | Back / forward 10s | | <kbd>A</kbd> | Add to a playlist |
| <kbd>S</kbd> | Shuffle what's on screen | | <kbd>/</kbd> | Search |
| <kbd>R</kbd> | Repeat | | <kbd>Esc</kbd> | Close |

---

## The digging model

The hierarchy is deliberate. **Playlist-building from your collection is the
primary job** — that's the main list, the shuffle button, and `A`. Digging is what
happens when something surprises you mid-shuffle, and it never takes over the
screen you were working in.

Press <kbd>D</kbd> on any playing track and you get the record's full Discogs
metadata, with **every field as a pivot** — artist, label, style, genre, country,
year, format, catalogue position, BPM, and how many people have and want it.
Click any of them to re-cut the crate by that value.

Below that, two lanes that differ on purpose:

### In your crate — instant, no network

Everything you already own that connects to this record:

```
More by      Moodymann
Rest of      Midnight Lowdown EP
On           Peacefrog
More         Deep House
From         1996–2000
Mixes with   124 BPM        ← includes half- and double-time matches
Pressed in   US
```

All of it computed from the local IndexedDB cache, so it appears the moment you
press the key. Click anything to play it; `+` adds it to a playlist.

### Beyond your crate — four Discogs lookups

Records you *don't* own, each tagged with the relationship that surfaced it:

| Lane | How it's found |
|---|---|
| **More by this artist** | The artist's discography, minus what you own |
| **More on this label** | The label's catalogue |
| **Same style** | Discogs search on the style, ranked by how many people want it |
| **Same era** | Style + a ±3 year window + country of pressing |

Each result gives you three things: **preview** (plays the audio Discogs has
linked, without owning the record), **♡** (writes to your actual Discogs
wantlist), and **⌕** (re-seeds the dig from *that* record).

That last one is what makes it endless. Dig from a record you don't own, land on
another, dig again. **"Dig again"** re-runs the same seed while excluding
everything you've already been shown, so the feed always moves.

### Why not a black-box recommender

Spotify's radio is a learned embedding — it works, and it can't tell you why.
Gemtopia goes the other way: every result is a real Discogs release ID reached
by a relationship you can see named on the card. When you're deciding whether to
spend £30 on a record, "because Moodymann released it on Peacefrog in 1997" is a
better answer than "listeners like you also enjoyed".

The playlist-level analysis (a separate, slower feature) optionally adds a Claude
pass to rank and explain those candidates — but it can only reorder what the
graph found. Any release ID the model invents is discarded before it renders. A
catalogue number you walk into a shop with has to exist.

### The records that were never there

The crate is built from the YouTube links Discogs holds against a release, so
for most of this app's life a record with no links produced no rows — and a
row that does not exist looks exactly like a record you do not own. You could
buy it, sync it successfully, see it on Discogs, and never once find it here.
There was a test asserting that behaviour, which is the uncomfortable part: it
was deliberate, and it was wrong.

They now appear, dimmed, with a struck-through play icon. **The two kinds of
silence are never reported as each other**, because they lead somewhere
different:

- **No preview** — Discogs holds no audio for this pressing. Permanent, and
  there is nothing to do about it.
- **Not synced** — the sync never fetched the release, so we do not actually
  know whether it has audio. One refresh away from being fixed, which is why
  that count in the header is a button.

`market` is what tells them apart: a real `/releases/{id}` fetch always returns
`num_for_sale` and `lowest_price`, so a null market can only be a placeholder
the sync wrote without ever reaching the release. Calling that "Discogs has no
audio" would be a confident wrong answer about a record you can play on Discogs
right now.

`Playable.videoId` is `string | null` rather than an empty-string sentinel,
specifically so the compiler finds every consumer that assumed a video exists.
It found four. Silent records are filtered at `playFrom`, the single door into
the queue, and `queueFrom` re-derives the index rather than reusing it — row 40
on screen is not row 40 in the queue once rows are dropped.

### The record that just arrived

Everything above works on records you already own. This is the one place the
app looks outward, and it exists because of a gap in the loop it otherwise
closes: records turn up in the post, and adding one meant leaving for
discogs.com, searching a site that is unkind on a phone, and coming back.

**The second line of each result is the whole feature.** Search "Untitled" on
Discogs and you get twelve pressings that look identical until you open each
one. You are not looking for *a* pressing of this record — you are looking for
the one in your hand. Year, catalogue number, label, country and format on one
truncated monospace line answers that without a tap, and every row stays the
same height so the list is scannable rather than readable.

**Four fields, chosen rather than guessed.** `q` is a fuzzy match over artist
and release title and **does not look at tracklists**, so searching a track
name used to return nothing whenever that name was not also the release title —
which for a 12" of untitled cuts is always. Discogs exposes `track` for exactly
this, and `catno` and `barcode` are exact-match fields where a value typed into
`q` would just be noise. Inferring the field from the shape of the input was the
alternative; plenty of real record titles look like catalogue numbers, and a
search that quietly ran a different query than you asked for is worse than a tap.

Searching is explicit — submit, not debounced-as-you-type. Discogs allows 60
authenticated requests a minute for the whole account, shared with a collection
sync that may be running in another tab. A request per keystroke would race the
thing that makes the app usable at all.

**Opening a result costs one request, and buys the one fact the list cannot
have.** The search response carries no video links, so until a release is
fetched there is no honest way to say whether it has anything to play.
Expanding a row fetches it once and shows the tracklist, copies for sale, the
green in-collection tick, and whether any previews exist. If that fetch fails
it says the release could not be loaded — not "no previews", which would be a
claim about the record invented out of a failure of ours.

**Adding to your collection asks first; the heart doesn't.** That asymmetry is
the whole argument. The wantlist is a toggle — press the heart again and the
record leaves — so a confirmation there would be friction with nothing behind
it. A collection add has no undo anywhere in this app, on purpose, so a mis-tap
on a phone can only be fixed by opening Discogs on something else. The
confirmation isn't friction; it's the only safety net that exists.

It's an inline strip rather than a dialog, because the disambiguation line sits
three pixels above it and that line is the thing being confirmed — a modal
covering the row would hide the evidence. And if you already own the record it
says so, since Discogs models a collection as instances and a second copy is
legal but rarely intended.

**Adding makes it playable now.** A collection sync walks everything you own
and takes about ten minutes on a large collection — fine as a background
top-up, useless when you are stood at the decks with the record in your hand.
So the add path fetches that one release and writes it exactly where a sync
would have: the summary index and the detail cache. Nothing downstream has a
special case for it.

Two honesty constraints fell out of that, both in `client/adopt.ts`:

- A crate is built from the YouTube links Discogs holds against a release, so a
  pressing with no links is a record you now own that will **never** appear in
  the list. Saying "added to your collection" next to a crate that did not
  change is how people end up pressing the button twice. The message names
  which of the two things happened.
- The add and the detail fetch are two calls, and only the first changes
  anything on Discogs. If the POST lands and the fetch then fails, the record
  *is* in your collection, and the message must not read like nothing happened.

### What's not built

**Reddit mining** — deferred by choice. It needs its own OAuth app, costs money
above the free tier, and returns unstructured comment text that would need an LLM
pass *and* a Discogs verification pass to be trustworthy. The dig engine is
structured so an adapter can drop in later without a rewrite.

**Identifying a record from a photo** — deferred, not abandoned. Discogs has no
image search endpoint, so this would mean a vision model reading the label and
then a Discogs lookup on what it read. The lookup half is what shipped here;
`catno` and `barcode` are already plumbed through the search route as exact-match
parameters, which is precisely what a photo of a label or a sleeve barcode would
produce. The remaining question is who pays for the vision call, and that is a
product question rather than a technical one.

**Browsing stores with recent finds** — not possible. The Discogs API exposes no
way to enumerate sellers or their recent stock. What it *does* expose is per
release: how many copies are for sale and the lowest asking price, both of which
Gemtopia shows with a deep link to the marketplace page.

---

## BPM, and how it actually works

The obvious approach is impossible, so it's worth saying why. The YouTube player
is a cross-origin iframe — `createMediaElementSource` needs an element from our
own document, and the IFrame API exposes no samples. You cannot reach in.

What you *can* do is capture the tab's audio **on its way to the speakers** with
`getDisplayMedia({ audio: true })`. Approve it once per session and every track
afterwards gets analysed: spectral-flux onset detection → whitening →
autocorrelation → comb filtering across four harmonics → a stability gate that
waits for the reading to hold for ~6 seconds before storing anything.

Nothing is downloaded, stored, or re-transmitted. The only thing that leaves the
module is an integer.

**Three sources, with precedence enforced in SQL, not in the browser:**

```
manual / tap   ─┐
                ├─▶ always beats ─▶  auto detection ─▶ beats ─▶ text-parsed
stronger auto  ─┘                                                (from Discogs
                                                                  notes/titles)
```

The background detector can never overwrite a number you tapped in yourself.
Six test cases pin that behaviour.

**Caveats, plainly:**

- Tab audio capture is **Chromium-only** (Chrome, Edge, Brave, Arc). Firefox and
  Safari fall back to microphone capture off your speakers, or tap tempo.
- You must tick **"Share tab audio"** in the picker or no audio track arrives —
  the app will tell you.
- **Jungle and DnB read at half tempo** about as often as not. A 174 BPM track
  with a half-time snare genuinely describes 87, and every estimator splits on
  which to report. There's a one-click **÷2 / ×2**, and a tap always wins.

**The tempo filter** defaults to **75–180 BPM** — wide enough for hip hop through
jungle — but the inputs accept 40–260, so nothing is fenced in. `÷2` and `×2`
scale the *whole window*, for finding half- and double-time versions of what
you're playing.

The style presets underneath aren't guesses. Once you've catalogued a few tempos,
Gemtopia computes the 10th–90th percentile of what each style actually runs at
**in your collection** and offers those as chips. Your Detroit techno might sit at
132–138; the chip will say so.

---

## Set prep: will these records actually mix?

Open a playlist and every transition is checked against the pitch range of the
decks you play on. The strip between two records tells you whether they
beatmatch, at what tempo, and how far each fader has to move:

```
  Basement Cut · Moodymann                                      124
↳ Mixes         Meet at 125 · ±0.8% each                              ← green
  Chrome Cut · Theo Parrish                                     126
↳ Mixes         Meet at 128.5 · ±1.9% each
  Sunset Cut · Larry Heard                                      131
↳ Out of range  Needs ±15.4% — wider than your ±8%                    ← amber
  Nocturne Cut · Omar-S                                          96
↳ Half-time     Meet at 91.3 at half-time · ±4.9% each                ← blue
  Midnight Cut · Moodymann                                      174
```

A summary bar above shows the shape of the set at a glance — *"2 of 6 won't
beatmatch"* — and **Smooth order** reorders the playlist so they do.

### The maths, because it is easy to get wrong

**A pitch fader is a percentage, not a BPM offset.** ±8% on a Technics is ±7.2
BPM at 90 and ±13.9 BPM at 174. Implementing "±8" as "within 8 BPM" would be
wrong at both ends.

**Both decks have a pitch fader.** You are not obliged to hold the outgoing
record at zero and drag the incoming one to meet it — pull one up, push the
other down, meet in the middle. Two records at A and B BPM can meet if

```
A·(1 + x) = B·(1 − x)   for some pitch fraction x ≤ your range
```

which solves to `x = |B − A| / (A + B)`, and they meet at `2AB/(A + B)` — the
harmonic mean. So the whole test is one subtraction and one division.

This is not a detail. **124 → 140** needs 11.4% if only the incoming record
moves, which is off the end of a 1200. Meeting in the middle it needs 6.1% —
comfortably inside. A one-sided check would tell you to leave that record at
home for no reason.

**Half and double time count.** An 87 BPM record and a 174 BPM record share a
beat grid at 2:1 with no pitch change at all. Every pair is tested at 1:1, 2:1
and 1:2, and the cheapest fit wins.

### Deck presets

Default is **±8% — Technics SL-1200/1210**, because that is what is in most
booths. Also built in: Pioneer CDJ ±6 and ±10, the ±16 wide range on an
SL-1200MK7 / PLX-1000 / CDJ, and ±50 for digital. Or type any number. The
setting is stored against your account and drives the playlist checks, the
"mixes with" filter, and the tempo lane in the dig drawer.

The mixable window shown in the filter is *not* `bpm ± range` — with both decks
pitching, ±8% around 124 BPM reaches **105.6–145.7**, which is a good deal more
of your crate than the 114–134 a naive reading suggests.

---

## Where the data comes from

Worth being unambiguous, because it's the question people ask:

**Every genre, style, label, artist, country and format in the filter panel is
Discogs metadata from your own records.** There is no hardcoded taxonomy anywhere
in this codebase. The path is:

```
sync.ts  ──fetches──▶  discogs.ts  ──reads genres/styles/labels──▶
computeFacets()  ──counts across your synced pool──▶  the chips you see
```

The number beside each chip is how many clips in your crate carry that tag, and
the whole panel re-ranks as the sync fills in. If a style shows up, it's because
you own records tagged with it.

### Playlists are Gemtopia's, not Discogs'

Discogs has no playlist concept. The nearest thing is a **List**, and a List is
release-level, unordered for playback, and **read-only through the API** — there
is no endpoint to create one. So a Gemtopia playlist could not be mirrored onto
your Discogs account even if that were wanted.

They're also a different shape. A playlist row is keyed on `releaseId:videoId` —
one specific clip on one specific release, in a specific position, carrying its
own BPM and the mixability verdict for the transition into the next one. A List
can hold none of that. Playlists live in Gemtopia's own Postgres, in
`playlists` / `playlist_items`, private to your account.

**Your collection is add-only. Your wantlist is a toggle.** Grep for
`writeRequest` and you will find exactly three callers: `addToWantlist`
(`PUT`), `removeFromWantlist` (`DELETE`) and `addToCollection` (`POST`). The
heart has to be able to turn off, so a wantlist delete exists and always will.

There is deliberately no `removeFromCollection`. Not a guarded one, not an
unreachable one — the function does not exist, so no route, no bug and no
crafted request can reach a `DELETE` against your collection, and the one
`DELETE` that does exist can only address `/wants/{id}` because that path is
written at its own call site. Removing a record is something Discogs does
perfectly well, and this app has no business doing it at three in the morning
next to a fader. Your Lists, your profile, your marketplace listings:
untouched, always.

That restraint is the app's own choice rather than a permission boundary, and
the difference matters. Discogs' OAuth 1.0a has no scopes, so the token every
Discogs app holds — including this one — carries the full authority of the
account. There is no way to ask for a read-mostly token. What bounds this app
is public source you can audit and a credential that is never stored anywhere
this app controls; [THREAT_MODEL.md §12.1](./THREAT_MODEL.md) sets out the whole
argument, including
the part that isn't solved.

---

## Privacy

**Playlists are private. There is no public URL, and no route that serves a
playlist to anyone but its owner.**

- Every query in `lib/repo.ts` filters by `user_id`. There is no function that
  takes a playlist ID without also taking the owner's ID.
- A playlist belonging to someone else returns **404, not 403** — the response
  doesn't even confirm the ID exists.
- The `visibility` column is `NOT NULL DEFAULT 'private'` and cannot be set from
  a request; the API schemas reject the field outright.
- Tests assert all of the above, including that the obvious share-URL shapes
  return 404.

### The one exception, and why it looks like one

Share links exist now, and they are the single deliberate hole in that model —
built so that a reviewer can find the whole of it in one place.

**`repo.getPlaylistByShareToken` is the only function in `repo.ts` that does
not take a user id.** That is the design: the exception is one named function,
not an `if` inside a function that also serves owners. Anyone asking "what can
an anonymous request reach?" has exactly one answer to read.

- Off by default. `share_token` is NULL until you ask for a link.
- The token *is* the credential: 32 bytes of CSPRNG output, base64url, unique,
  and not derived from the playlist id — knowing one token tells you nothing
  about another.
- Read only. There is no write path that accepts a token.
- Revocation is destruction. Turning sharing off sets the token to NULL, so the
  link you sent someone is dead rather than dormant, and re-sharing mints a
  different one.
- Unknown, malformed and revoked tokens all return the same 404. A link that
  stops working reveals nothing about why.
- The response carries the set list and nothing else — no user id, no username,
  no other playlist, no route back to the owner's account. A test asserts each
  of those absences by name.
- The page is `noindex, nofollow`. A share link is private by obscurity, and an
  indexed one would be simply public.

The threat this accepts is exactly the one a share link is for: whoever holds
the URL can read that playlist. Nothing more.

Your collection index never leaves your device. Only playlists, the BPM
catalogue, and cached analyses are stored server-side.

### Signing out everywhere

Sessions are stateless — your Discogs token lives in a sealed cookie, not in a
database — which is good for what a breach would yield and awkward for
revocation. **Sign out everywhere** in the account menu bumps a version number
stored against your account; that version is sealed into every cookie and
checked on each request, so a laptop left at a venue or a phone in a stolen bag
stops working immediately. Signing back in works straight away.

It costs no extra database round trip: resolving your session into a user id
was already a query, and the version comes back in the same row. Full write-up
in [THREAT_MODEL.md §6](./THREAT_MODEL.md).

---

## Deploy it

**Full walkthrough: [DEPLOYING.md](./DEPLOYING.md)** — eleven sequenced steps, a
first-run test checklist, and troubleshooting. What follows is the summary; the
ordering in that file matters and this one glosses over it.

### The short version

1. **Neon** — create a project for development and copy the **pooled**
   connection string (the host containing `-pooler`).
2. **`npm run keygen`** — your `SESSION_SECRET`.
3. **A Discogs app** pointed at `http://localhost:3000/api/auth/callback`.
4. **Run it locally** — `cp .env.example .env.local`, fill it in,
   `npm run db:migrate`, `npm run dev`.
5. **Push to GitHub**, then import to Vercel.
6. **A second Neon project** for production, in the region your functions run
   in — Vercel defaults to `iad1`, so `us-east-1`. Sharing one database between
   development and production means a stray migration or a test run reaches
   real users' rows.
7. **A second Discogs app** pointed at your real Vercel URL, and a **second**
   `SESSION_SECRET`. Both halves matter: that secret mints sessions, so a
   shared one lets a laptop impersonate any production user.
8. **Set the environment in Vercel**, scoped to **Production only**, redeploy,
   and run the migration against the production database
   (`npm run verify:db -- --migrate`).

### The trap, since it catches everyone

A Discogs application holds **one** callback URL that must match `APP_ORIGIN`
character for character — but your Vercel URL does not exist until after you have
deployed. So you cannot register the production callback up front.

Hence two Discogs applications, and hence the first Vercel deploy being expected
to **fail**: it runs without configuration purely so Vercel will tell you the URL.
The failure is [`src/lib/env.ts`](./src/lib/env.ts) validating at build time, which
is what stops a misconfigured deploy from 500ing at users later instead.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DISCOGS_CONSUMER_KEY` | yes | |
| `DISCOGS_CONSUMER_SECRET` | yes | Never leaves the server |
| `SESSION_SECRET` | yes | 32 bytes base64url — `npm run keygen` |
| `APP_ORIGIN` | yes | No trailing slash |
| `DATABASE_URL` | yes | Neon **pooled** string |
| `DISCOGS_CONTACT` | advised | Discogs requires a contact in the User-Agent |
| `ANTHROPIC_API_KEY` | optional | Enables the written playlist analysis |

### Local

Node 22 or newer (`.nvmrc` pins it) — the two pure-logic test suites use Node's
built-in TypeScript stripping. The app itself is not fussy.

Pointing local development at the same Neon database avoids installing Postgres:

```bash
cp .env.example .env.local     # npm run keygen for SESSION_SECRET
npm install
npm run db:migrate
npm run dev
```

Two checks exist because neither failure announces itself:

```bash
npm run verify:discogs   # does Discogs accept your signature?
npm run verify:db        # does that connection string resolve, connect, and
                         # have tables?  --migrate applies the schema,
                         # --copy returns it with sslmode=verify-full
```

`next build` never opens a database connection, so a wrong `DATABASE_URL`
deploys green and surfaces as a confusing error at the first sign-in. Neither
script prints a secret — the password is reported only as a length.

### The first sync takes ten minutes, and that's Discogs' fault

Discogs allows **60 authenticated requests per minute**. Listing 1,500 records is
15 requests; fetching each one's tracklist and videos is 1,500 more. So the first
sync runs about **10–12 minutes** in the background while you use whatever has
already loaded. Progress saves after every batch — close the tab and it resumes.
Later syncs only fetch what you've added.

### How a change reaches production

Nothing lands on `main` directly. The `protect-main` ruleset blocks direct
pushes, force-pushes and branch deletion, and requires a pull request whose
`verify` and `CodeQL` checks are green.

```
branch  ->  PR  ->  verify + CodeQL green  ->  merge  ->  Vercel deploys main
```

Required approvals are **0**, deliberately. GitHub will not let a maintainer
approve their own pull request, so on a solo project a non-zero requirement
means locking yourself out of your own repository — and a rule you have to
route around is worse than no rule. Everything else still holds: no direct
push, no force-push, nothing merges red.

**What CI gates**, in order, so a failure names its own cause: typecheck, lint,
`npm audit --audit-level=high`, 467 offline tests, the schema applied to a
throwaway Postgres, a production build, an assertion that no server-only secret
reached the client bundle, then 80 API tests against a running server. CodeQL
runs the `security-and-quality` suite separately.

The audit step earns its keep. The **first** CI run on this repository failed —
two critical unauthenticated RCEs (CVSS 9.5) in the pinned `next` release,
caught before the code reached anybody.

**Supply chain.** Every action is pinned to a full commit SHA with the version
in a trailing comment, and the repository *requires* SHA pinning. A tag is a
pointer its owner can move, which is precisely how the `tj-actions/changed-files`
compromise worked: existing tags were repointed at malicious code and every
workflow referencing them executed it on the next run. `GITHUB_TOKEN` is
read-only. Workflows from forked pull requests need maintainer approval before
they run. Dependabot groups patch and minor updates into a single PR and gives
every major its own, because a green check on a major bump means "it compiled",
not "it is safe".

**Preview deployments are off.** Vercel branch tracking is disabled rather than
issuing Preview a set of environment variables. A preview URL changes per
deployment, so it can never satisfy the Discogs callback — and the only way to
make preview builds pass would have been to hand them the production database
and session key. CI already validates pull requests; previews bought nothing
worth that trade. Branch deployments remain available on demand via the CLI.

**Environments are separated end to end**: two Neon projects, two Discogs
applications, two `SESSION_SECRET`s, and Vercel variables scoped to Production
only. A credential leaked from local development cannot read, write or
impersonate anything in production. This matters more than it looks — the API
test harness forges valid sessions using `SESSION_SECRET`, so a shared one
would make any developer's laptop able to mint a production session for any
user.

Also covered in [DEPLOYING.md](./DEPLOYING.md).

## Architecture

```
Browser                          Vercel (serverless)            External
────────                         ───────────────────            ────────
React 19 UI                      /api/auth/*      ──OAuth1──▶   discogs.com
IndexedDB crate cache   ◀──────  /api/discogs/*   ──signed──▶   api.discogs.com
Web Audio BPM detector           /api/dig         ──signed──▶
YouTube IFrame player            /api/wantlist    ──signed──▶   (writes)
        │                        /api/playlists/* ─┐
        │                        /api/track-meta ──┼──▶ Neon Postgres
        │                        /api/insights ────┘        │
        │                                     └──optional───┴──▶ api.anthropic.com
        └── sealed HttpOnly cookie (AES-256-GCM, holds the Discogs token)
```

Four properties worth calling out:

1. **The browser never crosses into third-party territory.** CSP `connect-src 'self'`
   forbids it. Every Discogs and Anthropic call is signed or keyed server-side, so
   no credential exists in client JavaScript.
2. **The Discogs token is never in a database.** It lives only inside an encrypted
   `HttpOnly` cookie. Nothing to breach.
3. **Nonce-based CSP.** Fresh nonce per request, `strict-dynamic`, `default-src 'none'`,
   zero `unsafe-inline` scripts.
4. **Five runtime dependencies.** `next`, `react`, `react-dom`, `zod`, `pg`. OAuth 1.0a
   signing is ~80 lines written in-repo rather than pulled from npm, so no third-party
   package ever holds the consumer secret.

```
db/schema.sql                  tables, constraints, ownership cascades
scripts/
├── migrate.mjs                idempotent schema application
├── verify-discogs.mjs         real OAuth handshake, no deps, redacts on failure
├── test-env.mjs               configuration contract (36 cases)
├── test-headers.mjs           security headers, both directions (20 cases)
├── test-playables.mjs         clip choice, silent records, queueing (29 cases)
├── test-sorting.mjs           crate ordering, and where unknowns go (24 cases)
├── test-share.mjs             what actually reaches the share sheet (28 cases)
├── test-scrub.mjs             playhead position maths (12 cases)
├── test-ownership.mjs         "do I own this?" without claiming absence (22 cases)
├── test-recent-playlists.mjs  which playlist you probably mean (12 cases)
├── test-adopt.mjs             add -> playable, and what to say (15 cases)
├── test-search-fields.mjs     what actually leaves the browser (11 cases)
├── test-write-surface.mjs     every write this app can send (7 cases)
├── test-playback-errors.mjs   whose fault a failed clip is (10 cases)
├── test-playback-watchdog.mjs a clip that never starts at all (12 cases)
├── test-crate-freshness.mjs   when to look for new records (8 cases)
├── test-bpm-scaling.mjs       the octave fix, and its limits (10 cases)
├── test-playlist-order.mjs    drag-to-reorder, both directions (10 cases)
├── test-tempo.mjs             estimator vs synthetic signals (37 cases)
├── test-mixing.mjs            beatmatch maths and set length (61 cases)
└── test-api.mjs               auth, CSRF, IDOR, sharing, privacy (80 cases)
src/
├── proxy.ts                   per-request CSP + script nonce
├── lib/                       server-only
│   ├── env.ts                 fail-fast, Zod-validated configuration
│   ├── crypto.ts              AES-256-GCM seal/unseal, constant-time compare
│   ├── oauth1.ts              hand-rolled OAuth 1.0a HMAC-SHA1 signing
│   ├── session.ts             sealed cookie sessions, CSRF, handshake state
│   ├── auth.ts                the guard every route handler starts with
│   ├── db.ts                  pooled Postgres, parameterised queries only
│   ├── repo.ts                data access — every query scoped by user_id
│   ├── discogs.ts             signed client, graph traversal, search, writes
│   ├── dig.ts                 four-lane dig from one seed release
│   ├── mixing.ts              beatmatch maths, deck presets, set sequencing
│   ├── recommend.ts           playlist profiling and candidate scoring
│   ├── llm.ts                 optional Claude pass + anti-hallucination filter
│   ├── validation.ts          every accepted payload shape, in one file
│   └── ratelimit.ts           sliding-window limiter
├── app/api/                   auth · discogs · dig · wantlist · collection · playlists · track-meta · insights
├── client/                    browser-only
│   ├── db.ts                  IndexedDB crate cache
│   ├── sync.ts                resumable, rate-limit-aware background sync
│   ├── playables.ts           video↔track matching, Fisher–Yates, spread shuffle
│   ├── digLocal.ts            in-collection pivots, zero network
│   ├── adopt.ts               a just-added record, folded into the crate
│   ├── searchFields.ts        which Discogs field a search runs against
│   ├── playbackErrors.ts      whether a failed clip is the video or the browser
│   ├── playbackWatchdog.ts    noticing a clip that never started
│   ├── crateFreshness.ts      when a finished sync stops being trusted
│   ├── bpmScaling.ts          halve/double, and the range it refuses
│   ├── playlistOrder.ts       moving a row, without an off-by-one
│   ├── useCrateCache.ts       what you own, and its persistence
│   ├── ownership.ts           what the app may claim about what you own
│   ├── share.ts               exactly what crosses into the share sheet
│   ├── tempo.ts               pure tempo estimator + tap tempo + BPM parsing
│   ├── useTempoDetector.ts    tab/mic capture → onset envelope
│   └── api.ts                 typed client, CSRF on every mutation
└── components/                UI
```

---

## Testing

```bash
npm run test           # everything below
npm run test:env       # 36 cases, no server needed
npm run test:headers   # 20 cases, no server needed
npm run test:playables # 29 cases, no server needed
npm run test:sorting   # 24 cases, no server needed
npm run test:share     # 28 cases, no server needed
npm run test:scrub     # 12 cases, no server needed
npm run test:ownership # 22 cases, no server needed
npm run test:recent    # 12 cases, no server needed
npm run test:adopt     # 15 cases, no server needed
npm run test:search    # 11 cases, no server needed
npm run test:writes    # 7 cases, no server needed
npm run test:playback  # 10 cases, no server needed
npm run test:watchdog  # 12 cases, no server needed
npm run test:freshness # 8 cases, no server needed
npm run test:bpm-scale # 10 cases, no server needed
npm run test:order     # 10 cases, no server needed
npm run test:tempo     # 37 cases, no server needed
npm run test:mixing    # 61 cases, no server needed
npm run test:api       # 80 cases, needs a running server + Postgres
npm run typecheck
npm run lint
npm run audit:ci
```

**`test-headers.mjs`** asserts the security headers in *both* directions: the
capabilities the app needs are granted, and the ones it doesn't are denied. It
exists because `Permissions-Policy: display-capture=(), microphone=()` shipped
and silently disabled BPM detection on every deployment — an empty allowlist
denies a feature to the page itself, not just to third parties. Both detection
modes failed, and the browser reported only `NotAllowedError`, which is the
same exception a user gets for dismissing the picker, so the message read
"audio capture was not allowed" and pointed at Chrome's settings rather than at
our own response header. Hardening that removes a capability the product
depends on is invisible in review: the diff that breaks it looks exactly like
the diff that secures it. Now a tightening pass has to change a test on its way
through.

**`test-env.mjs`** covers the configuration contract, and exists because of a
bug that reached a user on their very first run. Every optional field rejected a
present-but-blank value, so a `.env.local` copied from `.env.example` — exactly
what the docs instruct — refused to boot with *"ANTHROPIC_API_KEY: String must
contain at least 10 character(s)"* on a key documented as optional. A `.env` file
cannot express absence: a bare `KEY=` arrives as `""`, which `.optional()` does
not catch, `.default()` does not fill, and `z.coerce.number()` turns into 0. The
fix normalises blank to absent once, before parsing; the tests pin that for every
optional field, and separately assert that a present-but-*wrong* value is still
an error. Writing them immediately found a second bug: `z.string().url()` accepts
`localhost:3000`, because `new URL()` reads it as scheme `localhost:` with path
`3000` — which would have validated and then built a callback URL Discogs could
never match.

**`test-tempo.mjs`** synthesises onset envelopes at known tempi — with jitter,
noise, off-beat hats and backbeats — and asserts the estimator recovers them. It
caught two real bugs during development: integer lag resolution breaking above
160 BPM, and then a *worse* first fix where interpolating the signal at
fractional lags flattened sharp onsets. The comments in `tempo.ts` explain both,
because the second one is the sort of mistake that's easy to make twice.

**`test-mixing.mjs`** checks the beatmatch maths against tempos worked out by
hand rather than against the implementation — which is how it caught the author
asserting that 90 → 128 needs ±17.4%, when counting the 128 at half-time gets
there for ±16.9%. That case is still in the file with a comment saying so.

**`test-api.mjs`** runs against a live server and a real Postgres. It forges its
own session cookies using `SESSION_SECRET` — which is only possible *because* the
test holds the key. That's the sealing guarantee demonstrated rather than
asserted. It covers authentication, CSRF, five IDOR cases, playlist privacy,
input validation, and the BPM precedence rules.

CI runs all of it plus a production build and a check that no server-only secret
ever landed in the client bundle.

---

## Known limits

- Tab audio capture is Chromium-only; others get mic capture or tap tempo.
- Jungle/DnB tempo often reads at half — use ÷2 / ×2, or tap it.
- Clips that are private, deleted, or region-blocked on YouTube auto-skip after ~1s.
- Discogs' video data is patchy. Some releases have none; that's upstream.
- The rate limiter is per serverless instance — see *Residual risks* in THREAT_MODEL.md.
- Musical key / Camelot harmonic mixing isn't built. The column exists, and it
  is the natural companion to the tempo checks.
- Transition checks assume a constant tempo per record. Live drummers and
  hand-played records drift; the flag is a guide, not a guarantee.

---

## Licence

MIT — see [LICENSE](./LICENSE).

Not affiliated with Discogs, YouTube, Bandcamp, Spotify, or Anthropic. Gemtopia
uses the Discogs API under their terms and embeds YouTube's player under theirs.
