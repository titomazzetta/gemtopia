# CrateShuffle

A Bandcamp-style shuffle player and playlist maker for your **Discogs collection and wantlist**, built for DJs who want to dig through a crate fast.

Filter down to a style, a label, a year range. Shuffle what's left. Build a playlist while it plays. Keyboard-driven, no page reloads, works on a laptop at a gig.

---

## What it actually does

| | |
|---|---|
| **Shuffle the crate** | Fisher–Yates over every clip Discogs holds for your collection, then spread so the same release never lands back to back. |
| **Filter, then shuffle** | Style, genre, label, year range, free-text. Facets are counted live, so you can see how big the pool is before you commit. |
| **Playlists on the fly** | <kbd>A</kbd> while something plays. Drag to reorder, play in order or shuffled, export/import as JSON. |
| **Wantlist mode** | Same flow against your wantlist, for auditioning rather than digging. |
| **Offline-ish** | Your crate index lives in IndexedDB. After the first sync the app opens instantly and works without re-hitting Discogs. |

### Keyboard

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> / <kbd>→</kbd> | Previous / next |
| <kbd>J</kbd> / <kbd>L</kbd> | Back / forward 10 seconds |
| <kbd>S</kbd> | Shuffle what's on screen |
| <kbd>R</kbd> | Toggle repeat |
| <kbd>A</kbd> | Add current clip to a playlist |
| <kbd>/</kbd> | Focus search |

---

## Two things to know before you start

**1. Discogs attaches videos to releases, not tracks.**

This is the central constraint of the whole app. A release with eight tracks might have eight YouTube links, or one link to a full side, or three links titled `Artist - Track (Original Mix) [HQ]`. CrateShuffle matches video titles against the tracklist and labels every clip with what it found:

- <kbd>track</kbd> — matched to a single tracklist entry with reasonable confidence
- <kbd>release</kbd> — attached to the release; could be a full album, a side, or a mix

The **"Only clips matched to a single track"** filter narrows to the first kind when you want clean, single-track shuffling.

**2. The player stays visible, on purpose.**

YouTube's API terms require an embedded player keep a viewport of at least 200×200 px and forbid covering it. Ripping the audio stream out and dropping the video is a terms violation that gets apps shut off. So CrateShuffle keeps a real player — it just demotes it to the role of album art in the corner and drives everything through its own transport controls. You get the Bandcamp flow without building something that breaks the first time anyone looks at it.

---

## Deploy to Vercel

### 1. Register a Discogs application

Go to **[discogs.com/settings/developers](https://www.discogs.com/settings/developers)** → *Create an application*.

- **Callback URL** must be exactly `https://YOUR-APP.vercel.app/api/auth/callback`
- Copy the **Consumer Key** and **Consumer Secret**

You can add a second application pointing at `http://localhost:3000/api/auth/callback` for local development.

### 2. Push and deploy

```bash
git init && git add -A && git commit -m "CrateShuffle"
gh repo create crateshuffle --private --source=. --push
npx vercel            # link the project
npx vercel --prod
```

### 3. Set environment variables

In the Vercel dashboard → *Settings* → *Environment Variables*, or:

```bash
npm run keygen                       # prints a fresh SESSION_SECRET

npx vercel env add DISCOGS_CONSUMER_KEY    production
npx vercel env add DISCOGS_CONSUMER_SECRET production
npx vercel env add SESSION_SECRET          production
npx vercel env add APP_ORIGIN              production   # https://your-app.vercel.app
npx vercel env add DISCOGS_CONTACT         production   # a URL or email
```

`APP_ORIGIN` must match your real deployment URL with **no trailing slash** — it is used to build the OAuth callback and to reject mismatched origins.

Redeploy after setting them: `npx vercel --prod`.

### 4. Run it locally

```bash
cp .env.example .env.local     # fill in, use npm run keygen for SESSION_SECRET
npm install
npm run dev                    # http://localhost:3000
```

---

## First sync takes a while, and that's Discogs' fault

Discogs allows **60 authenticated requests per minute**. Listing a 1,500-record collection is 15 requests; fetching each release's tracklist and videos is 1,500 more.

So the first sync of a 1,500-release collection takes roughly **10–12 minutes**, running in the background while you use whatever has already loaded. Progress is saved after every batch — close the tab and it resumes where it left off. Every sync after the first only fetches releases you have added since.

The refresh button in the header forces a full resync if you think something is stale.

---

## Architecture

```
Browser                          Vercel (serverless)              Discogs
────────                         ───────────────────              ───────
React 19 UI                      /api/auth/login    ──OAuth1──▶
IndexedDB crate cache   ◀──────  /api/auth/callback ◀─────────
YouTube IFrame player            /api/discogs/*     ──signed──▶  api.discogs.com
        │                                │
        └── sealed HttpOnly cookie ──────┘
            (AES-256-GCM, holds the Discogs token)
```

- **No database.** The Discogs token lives only inside an encrypted cookie; the crate index and playlists live only in your browser. The deployment stores no user data at rest.
- **The browser never talks to Discogs.** Every call is signed server-side, so the consumer secret and your access token never reach client JavaScript.
- **Nonce-based CSP.** No `unsafe-inline` scripts anywhere, `default-src 'none'`, `frame-src` limited to YouTube.

Full write-up, including the threat model and what is deliberately *not* mitigated: **[SECURITY.md](./SECURITY.md)**.

### Layout

```
src/
├── proxy.ts                  per-request CSP + script nonce (Next 16 "middleware")
├── lib/                      server-only
│   ├── env.ts                fail-fast, Zod-validated configuration
│   ├── crypto.ts             AES-256-GCM seal/unseal, constant-time compare
│   ├── oauth1.ts             hand-rolled OAuth 1.0a HMAC-SHA1 signing
│   ├── session.ts            sealed cookie sessions, CSRF, OAuth handshake state
│   ├── discogs.ts            signed API client + Zod response validation
│   ├── ratelimit.ts          in-process sliding-window limiter
│   └── api.ts                uniform JSON errors, no internal detail leaked
├── app/api/                  auth + Discogs proxy routes
├── client/                   browser-only
│   ├── db.ts                 IndexedDB cache
│   ├── sync.ts               resumable, rate-limit-aware background sync
│   ├── playables.ts          video↔track matching, Fisher–Yates, spread shuffle
│   └── useYouTubePlayer.ts   IFrame API wrapper
└── components/               UI
```

## Scripts

```bash
npm run dev         # local dev server
npm run build       # production build (fails on type errors)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm run audit:ci    # npm audit --audit-level=high
npm run keygen      # generate a SESSION_SECRET
```

## Known limits

- Playlists are per-browser. Export/import JSON is the way to move them between devices. (A server-side store is the obvious v2, at the cost of the "no database" property above.)
- Clips that are private, deleted, or region-blocked on YouTube auto-skip after ~1 second.
- Discogs' own video data is patchy. Some releases have nothing; that is upstream, not a bug here.
- The in-process rate limiter is per serverless instance — see *Residual risks* in SECURITY.md.

## Licence

MIT. Not affiliated with Discogs, YouTube, or Bandcamp.
