<div align="center">

# Playtopia

**Dig through your Discogs collection anywhere, hear it, build playlists from it,
and fall sideways into the records you don't own yet.**

[![CI](https://github.com/titomazzetta/playtopia/actions/workflows/ci.yml/badge.svg)](https://github.com/titomazzetta/playtopia/actions/workflows/ci.yml)
[![Security](https://img.shields.io/badge/threat%20model-SECURITY.md-4ade80)](./SECURITY.md)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

Playtopia is a DJ tool built on top of the Discogs API. It turns a record collection
into something you can actually *play* — shuffle it, filter it by tempo and style,
build playlists on the move, catalogue BPMs as you listen, and dig outward into
records you don't own but probably should.

It was built to be used on trains and in hotel rooms, and to be read by people
who care how software is put together. The [threat model](./SECURITY.md) is the
part I'd point at first.

---

## Contents

- [What it does](#what-it-does)
- [The digging model](#the-digging-model)
- [BPM, and how it actually works](#bpm-and-how-it-actually-works)
- [Where the data comes from](#where-the-data-comes-from)
- [Privacy](#privacy)
- [Deploy it](#deploy-it)
- [Architecture](#architecture)
- [Testing](#testing)
- [Known limits](#known-limits)

---

## What it does

| | |
|---|---|
| **Shuffle the crate** | Fisher–Yates over every clip Discogs has for your collection, spread so the same release never lands twice in a row. |
| **Filter on real metadata** | Style, genre, label, artist, format, country, decade, year and tempo — every option counted from *your* synced collection. |
| **Dig from anything** | Hit `D` on whatever's playing and pivot on any field. Two lanes: what else you own, and what exists beyond it. |
| **Playlists that follow you** | Stored against your Discogs account. Private by default, always. Drag to reorder, play in order or shuffled. |
| **BPM catalogue** | Detect tempo from the audio as it plays, or tap it in. Filter by range, or by what mixes with what's playing. |
| **Wantlist, both ways** | Shuffle your wantlist like a crate, and add to it from anywhere in the app — it writes to your real Discogs wantlist. |
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
Playtopia goes the other way: every result is a real Discogs release ID reached
by a relationship you can see named on the card. When you're deciding whether to
spend £30 on a record, "because Moodymann released it on Peacefrog in 1997" is a
better answer than "listeners like you also enjoyed".

The playlist-level analysis (a separate, slower feature) optionally adds a Claude
pass to rank and explain those candidates — but it can only reorder what the
graph found. Any release ID the model invents is discarded before it renders. A
catalogue number you walk into a shop with has to exist.

### What's not built

**Reddit mining** — deferred by choice. It needs its own OAuth app, costs money
above the free tier, and returns unstructured comment text that would need an LLM
pass *and* a Discogs verification pass to be trustworthy. The dig engine is
structured so an adapter can drop in later without a rewrite.

**Browsing stores with recent finds** — not possible. The Discogs API exposes no
way to enumerate sellers or their recent stock. What it *does* expose is per
release: how many copies are for sale and the lowest asking price, both of which
Playtopia shows with a deep link to the marketplace page.

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
Playtopia computes the 10th–90th percentile of what each style actually runs at
**in your collection** and offers those as chips. Your Detroit techno might sit at
132–138; the chip will say so.

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

A future opt-in share feature would have to add a function that *deliberately*
drops the `user_id` predicate — the kind of change that stands out in a diff,
which is the point.

Your collection index never leaves your device. Only playlists, the BPM
catalogue, and cached analyses are stored server-side.

---

## Deploy it

### 1. Discogs application

[discogs.com/settings/developers](https://www.discogs.com/settings/developers) →
*Create an application*.

- **Callback URL** must be exactly `https://YOUR-APP.vercel.app/api/auth/callback`
- Copy the Consumer Key and Consumer Secret
- Register a second app for `http://localhost:3000/api/auth/callback` if you want to develop locally

### 2. Postgres

[Neon](https://neon.tech) free tier. Create a project and a database called
`playtopia`, then copy the **pooled** connection string — the host with `-pooler`
in it. Serverless functions open and drop connections constantly and would
exhaust a direct endpoint.

### 3. Deploy

```bash
npx vercel && npx vercel --prod
```

### 4. Environment

```bash
npm run keygen                                       # prints a SESSION_SECRET

npx vercel env add DISCOGS_CONSUMER_KEY    production
npx vercel env add DISCOGS_CONSUMER_SECRET production
npx vercel env add SESSION_SECRET          production
npx vercel env add APP_ORIGIN              production   # https://your-app.vercel.app
npx vercel env add DISCOGS_CONTACT         production
npx vercel env add DATABASE_URL            production   # the -pooler string
npx vercel env add ANTHROPIC_API_KEY       production   # optional
```

`APP_ORIGIN` must match the deployment URL exactly, **no trailing slash** — it
builds the OAuth callback and rejects mismatched origins.

### 5. Tables

```bash
DATABASE_URL="<pooled string>" npm run db:migrate
```

Idempotent, so it's safe on every deploy.

### Local

```bash
cp .env.example .env.local     # npm run keygen for SESSION_SECRET
npm install
npm run db:migrate
npm run dev
```

### The first sync takes ten minutes, and that's Discogs' fault

Discogs allows **60 authenticated requests per minute**. Listing 1,500 records is
15 requests; fetching each one's tracklist and videos is 1,500 more. So the first
sync runs about **10–12 minutes** in the background while you use whatever has
already loaded. Progress saves after every batch — close the tab and it resumes.
Later syncs only fetch what you've added.

---

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
├── test-tempo.mjs             estimator vs synthetic signals (38 cases)
└── test-api.mjs               auth, CSRF, IDOR, privacy, validation (43 cases)
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
│   ├── recommend.ts           playlist profiling and candidate scoring
│   ├── llm.ts                 optional Claude pass + anti-hallucination filter
│   ├── validation.ts          every accepted payload shape, in one file
│   └── ratelimit.ts           sliding-window limiter
├── app/api/                   auth · discogs · dig · wantlist · playlists · track-meta · insights
├── client/                    browser-only
│   ├── db.ts                  IndexedDB crate cache
│   ├── sync.ts                resumable, rate-limit-aware background sync
│   ├── playables.ts           video↔track matching, Fisher–Yates, spread shuffle
│   ├── digLocal.ts            in-collection pivots, zero network
│   ├── tempo.ts               pure tempo estimator + tap tempo + BPM parsing
│   ├── useTempoDetector.ts    tab/mic capture → onset envelope
│   └── api.ts                 typed client, CSRF on every mutation
└── components/                UI
```

---

## Testing

```bash
npm run test           # everything below
npm run test:tempo     # 38 cases, no server needed
npm run test:api       # 43 cases, needs a running server + Postgres
npm run typecheck
npm run lint
npm run audit:ci
```

**`test-tempo.mjs`** synthesises onset envelopes at known tempi — with jitter,
noise, off-beat hats and backbeats — and asserts the estimator recovers them. It
caught two real bugs during development: integer lag resolution breaking above
160 BPM, and then a *worse* first fix where interpolating the signal at
fractional lags flattened sharp onsets. The comments in `tempo.ts` explain both,
because the second one is the sort of mistake that's easy to make twice.

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
- The rate limiter is per serverless instance — see *Residual risks* in SECURITY.md.
- Musical key / Camelot harmonic mixing isn't built. The column exists.
- No session revocation list yet — see SECURITY.md §9, item 2.

---

## Licence

MIT — see [LICENSE](./LICENSE).

Not affiliated with Discogs, YouTube, Bandcamp, Spotify, or Anthropic. Playtopia
uses the Discogs API under their terms and embeds YouTube's player under theirs.
