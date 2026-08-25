# CrateShuffle

A Bandcamp-style shuffle player, playlist maker and crate-digging tool for your **Discogs collection and wantlist**, built for DJs.

Filter to a style, a label, a year, a tempo. Shuffle what's left. Build a playlist while it plays, tap the BPM in as it runs, then have the app walk Discogs' artist-and-label graph to tell you what to dig for next.

---

## What it does

| | |
|---|---|
| **Shuffle the crate** | Fisher–Yates over every clip Discogs holds for your collection, spread so the same release never lands back to back. |
| **Filter on real metadata** | Style, genre, label, artist, format, country, decade, year range, tempo range, free text. Every option is counted from *your* synced collection — nothing is a hardcoded list. |
| **Playlists that follow you** | Stored in Postgres against your Discogs account, so they're on your laptop and your phone. Drag to reorder, play in order or shuffled, export/import JSON. |
| **BPM catalogue** | Detect tempo automatically from the audio as it plays, or tap it in. Stored per track, forever. Then filter by tempo range or "mixable with what's playing, ±3". |
| **Playlist dissection** | What a playlist is actually made of — styles, labels, artists, era, tempo spread — plus records to dig for, found by walking Discogs relationships. |
| **Wantlist mode** | The same flow against your wantlist, for auditioning rather than digging. |

### Keyboard

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next |
| <kbd>J</kbd> / <kbd>L</kbd> | Back / forward 10 seconds |
| <kbd>S</kbd> | Shuffle what's on screen |
| <kbd>T</kbd> | Tap tempo |
| <kbd>R</kbd> | Toggle repeat |
| <kbd>A</kbd> | Add current clip to a playlist |
| <kbd>/</kbd> | Focus search |

---

## Three things worth knowing before you start

### 1. Discogs attaches videos to releases, not tracks

This is the central constraint of the whole app. A release with eight tracks might have eight YouTube links, one link to a full side, or three titled `Artist - Track (Original Mix) [HQ]`. CrateShuffle matches video titles against the tracklist and labels every clip with what it found:

- <kbd>track</kbd> — matched to a single tracklist entry with reasonable confidence
- <kbd>release</kbd> — attached to the release; could be a full album, a side, or a mix

The **"Only clips matched to a single track"** filter narrows to the first kind.

### 2. The player stays visible, on purpose

YouTube's API terms require an embedded player keep a viewport of at least 200×200 px and forbid covering it. Extracting the audio stream and dropping the video is a terms violation that gets apps shut off. So CrateShuffle keeps a real player — it just demotes it to the role of album art in the corner and drives everything through its own transport controls.

### 3. How BPM detection actually works

The obvious approach — hook Web Audio into the YouTube player — is impossible. The player is a cross-origin iframe; `createMediaElementSource` needs an element from our own document, and the IFrame API exposes no samples.

What works instead is capturing the tab's audio **on its way to the speakers** with `getDisplayMedia({ audio: true })`. You approve it once per session, and every track that plays afterwards is analysed: spectral-flux onset detection → autocorrelation → comb filtering across four harmonics. Nothing is downloaded, stored or re-transmitted; the only thing that leaves the module is a number.

Caveats, stated plainly:

- **Tab audio capture is Chromium-only** (Chrome, Edge, Brave, Arc). Firefox and Safari don't implement it — those fall back to microphone capture off your speakers, or tap tempo.
- You must tick **"Share tab audio"** in the picker, otherwise no audio track arrives and the app will tell you so.
- **Jungle and DnB read at half tempo** as often as not. A 174 BPM track with a half-time snare pattern genuinely describes 87, and every tempo estimator splits on which to report. The panel has a one-click **÷2 / ×2** and a tap always overrides a detection.
- A reading is only stored once it has held steady for ~6 seconds, so an intro can't poison the catalogue.

Precedence is enforced in SQL, not in the browser: **a human tap or a manual correction always beats an automatic detection**, and a stronger detection beats a weaker one. The background detector can never quietly overwrite a number you tapped in yourself.

---

## Deploy

### 1. Register a Discogs application

**[discogs.com/settings/developers](https://www.discogs.com/settings/developers)** → *Create an application*.

- **Callback URL** must be exactly `https://YOUR-APP.vercel.app/api/auth/callback`
- Copy the **Consumer Key** and **Consumer Secret**

Register a second app pointing at `http://localhost:3000/api/auth/callback` for local development.

### 2. Create a Postgres database

[Neon](https://neon.tech) free tier is the intended target.

- Create a project and a database called `crateshuffle`
- Copy the **pooled** connection string — the host with `-pooler` in it

### 3. Push and deploy

```bash
git init && git add -A && git commit -m "CrateShuffle"
gh repo create crateshuffle --private --source=. --push
npx vercel && npx vercel --prod
```

### 4. Environment variables

```bash
npm run keygen                                # prints a fresh SESSION_SECRET

npx vercel env add DISCOGS_CONSUMER_KEY    production
npx vercel env add DISCOGS_CONSUMER_SECRET production
npx vercel env add SESSION_SECRET          production
npx vercel env add APP_ORIGIN              production   # https://your-app.vercel.app
npx vercel env add DISCOGS_CONTACT         production
npx vercel env add DATABASE_URL            production   # the -pooler string
npx vercel env add ANTHROPIC_API_KEY       production   # optional
```

`APP_ORIGIN` must match your real deployment URL with **no trailing slash** — it builds the OAuth callback and rejects mismatched origins.

### 5. Create the tables

```bash
DATABASE_URL="<your pooled string>" npm run db:migrate
```

The schema is idempotent, so this is safe to re-run on every deploy.

### Local development

```bash
cp .env.example .env.local     # fill in; npm run keygen for SESSION_SECRET
npm install
npm run db:migrate
npm run dev                    # http://localhost:3000
```

---

## First sync takes a while, and that's Discogs' fault

Discogs allows **60 authenticated requests per minute**. Listing a 1,500-record collection is 15 requests; fetching each release's tracklist and videos is 1,500 more.

So the first sync of a 1,500-release collection takes roughly **10–12 minutes**, running in the background while you use whatever has already loaded. Progress is saved after every batch — close the tab and it resumes. Every later sync only fetches releases you've added since.

---

## How the recommender works

The design principle: **every recommendation is a real Discogs release with a real id, found by walking real relationships.**

```
playlist ──▶ artists ──▶ their other releases            "More from X"
         │           └─▶ labels they appear on ──┐
         └──▶ labels ─▶ other releases on it ────┤       "Labelmate on Y"
                     └─▶ labelmate artists ──────┘
```

Candidates are then scored on how central each artist and label is to the playlist, how close the release sits to the playlist's era, and whether more than one path led to it. Anything already in your collection is dropped, and no artist may contribute more than three entries.

If `ANTHROPIC_API_KEY` is set, Claude then **reorders and explains** those candidates and writes a characterisation of the playlist. It cannot add to them: any release id in the model's response that wasn't in the request is discarded before it reaches the UI. That filter is what makes the output safe to act on — a DJ who walks into a shop with a catalogue number needs it to exist.

Without a key, the deterministic ordering is used as-is and the panel says so. Results are cached against a hash of the playlist's contents, so re-analysing an unchanged playlist costs nothing.

---

## Architecture

```
Browser                        Vercel (serverless)          Discogs / Anthropic
────────                       ───────────────────          ───────────────────
React 19 UI                    /api/auth/*     ──OAuth1──▶  discogs.com
IndexedDB crate cache  ◀─────  /api/discogs/*  ──signed──▶  api.discogs.com
Web Audio BPM detector         /api/playlists/* ─┐
YouTube IFrame player          /api/track-meta ──┼─▶ Neon Postgres
        │                      /api/insights ────┘        │
        │                                    └──optional──┴─▶ api.anthropic.com
        └── sealed HttpOnly cookie (AES-256-GCM, holds the Discogs token)
```

- **The browser never talks to Discogs or Anthropic.** Every call is signed or keyed server-side; CSP `connect-src 'self'` forbids anything else.
- **The Discogs token is never in client JavaScript.** It lives only inside an encrypted HttpOnly cookie.
- **The collection index stays on your device.** Only playlists, the BPM catalogue and cached analyses are stored server-side — the 1,500-release index with tracklists stays in IndexedDB.
- **Nonce-based CSP.** No `unsafe-inline` scripts, `default-src 'none'`, `frame-src` limited to YouTube.

Full write-up including the threat model: **[SECURITY.md](./SECURITY.md)**.

### Layout

```
db/schema.sql                  tables, constraints, ownership cascades
scripts/
├── migrate.mjs                idempotent schema application
├── test-tempo.mjs             tempo estimator vs synthetic signals
└── test-api.mjs               auth, CSRF, IDOR, validation, BPM precedence
src/
├── proxy.ts                   per-request CSP + script nonce
├── lib/                       server-only
│   ├── env.ts                 fail-fast, Zod-validated configuration
│   ├── crypto.ts              AES-256-GCM seal/unseal, constant-time compare
│   ├── oauth1.ts              hand-rolled OAuth 1.0a HMAC-SHA1 signing
│   ├── session.ts             sealed cookie sessions, CSRF, handshake state
│   ├── auth.ts                the route guard every handler starts with
│   ├── db.ts                  pooled Postgres, parameterised queries only
│   ├── repo.ts                data access — every query scoped by user_id
│   ├── discogs.ts             signed API client + graph traversal
│   ├── recommend.ts           profiling, candidate generation, scoring
│   ├── llm.ts                 optional Claude pass + anti-hallucination filter
│   ├── validation.ts          every accepted payload shape, in one file
│   └── ratelimit.ts           in-process sliding-window limiter
├── app/api/                   auth, Discogs proxy, playlists, track-meta, insights
├── client/                    browser-only
│   ├── db.ts                  IndexedDB crate cache
│   ├── sync.ts                resumable, rate-limit-aware background sync
│   ├── playables.ts           video↔track matching, Fisher–Yates, spread shuffle
│   ├── tempo.ts               pure tempo estimator + tap tempo + BPM parsing
│   ├── useTempoDetector.ts    tab/mic audio capture → onset envelope
│   └── api.ts                 typed client, CSRF on every mutation
└── components/                UI
```

## Scripts

```bash
npm run dev          # local dev server
npm run build        # production build (fails on type errors)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # tempo + API tests
npm run test:tempo   # estimator vs synthetic signals — no server needed
npm run test:api     # integration tests, needs a running dev server
npm run db:migrate   # apply db/schema.sql
npm run audit:ci     # npm audit --audit-level=high
npm run keygen       # generate a SESSION_SECRET
```

## Known limits

- Tab audio capture is Chromium-only; other browsers get mic capture or tap tempo.
- Jungle/DnB tempo often reads at half — use ÷2 / ×2 or tap it.
- Clips that are private, deleted, or region-blocked on YouTube auto-skip after ~1 second.
- Discogs' own video data is patchy. Some releases have nothing; that's upstream.
- The in-process rate limiter is per serverless instance — see *Residual risks* in SECURITY.md.
- Musical key / Camelot harmonic mixing isn't built yet. The `track_meta` table already has the column.

## Licence

MIT. Not affiliated with Discogs, YouTube, Bandcamp, or Anthropic.
