# Threat Model

Gemtopia holds a third-party OAuth credential that — because Discogs' OAuth
1.0a has no scope mechanism — grants **full read and write** access to a user's
Discogs account, stores user data in a shared database, renders text
written by strangers, captures audio from the user's machine, and optionally
forwards content to an LLM. Each of those is a distinct piece of attack
surface, and each is addressed below.

This document states what is defended, how, and — just as importantly — what is
**not** defended and why.

---

## 1. Trust boundaries

```
┌─ Untrusted ─────────────────────────────────────────────────────────────┐
│  The browser and everything in it. Every byte of every request.         │
│  Discogs API responses (user-generated titles, notes, arbitrary URLs).  │
│  Imported playlist JSON. LLM responses.                                 │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                    ══════════╪══════════  ← boundary A: HTTP request
                              │
┌─ Trusted ───────────────────────────────────────────────────────────────┐
│  Vercel serverless functions.                                           │
│  Environment variables (consumer secret, session key, Anthropic key).   │
│  Neon Postgres.                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                    ══════════╪══════════  ← boundary B: signed/keyed egress
                              │
┌─ Third party ───────────────────────────────────────────────────────────┐
│  api.discogs.com     (OAuth 1.0a, HMAC-SHA1; reads + two add calls)    │
│  api.anthropic.com   (optional, API key, server-side only)              │
│  youtube-nocookie.com (sandboxed iframe, no data flows out)             │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key property:** the browser never crosses boundary B. CSP `connect-src 'self'`
forbids it, so there is no code path in which an access token, the consumer
secret, or the Anthropic key exists in client JavaScript.

---

## 2. Assets

| Asset | Sensitivity | Where it lives |
|---|---|---|
| Discogs consumer secret | **Critical** — compromises every user | Vercel env var, server memory only |
| `SESSION_SECRET` (AES key) | **Critical** — forges arbitrary sessions | Vercel env var, server memory only |
| `ANTHROPIC_API_KEY` | **High** — billable | Vercel env var, server memory only |
| `DATABASE_URL` | **High** — all stored user data | Vercel env var, server memory only |
| User's Discogs access token | **Critical** — unscoped read *and write* on their account (see §12.1) | AES-256-GCM sealed cookie, browser only |
| Playlists, BPM catalogue, analyses | Moderate — reveals taste and listening | Postgres, scoped by `user_id` |
| Collection index (1,500 releases) | Low | The user's own IndexedDB, never uploaded |
| Captured tab audio | **High** while in memory | Never leaves the browser; see §6 |

The collection index deliberately stays client-side. Only the small,
cross-device-useful data went to Postgres in v2 — a conscious narrowing of what
a database breach would yield.

---

## 3. STRIDE

### Spoofing

| Threat | Control |
|---|---|
| Forged session cookie | AES-256-GCM sealed. GCM's auth tag means a tampered or fabricated cookie fails to decrypt; `unseal()` returns `null`. Forgery requires the 32-byte key. Covered by `test-api.mjs` → "a tampered session cookie is rejected". |
| Session fixation via the OAuth callback | The request token is sealed into a single-use, HttpOnly, 10-minute cookie. The callback refuses unless the `oauth_token` Discogs returns matches it (`safeEqual`, constant time). RFC 5849 §11.7. |
| Impersonating Discogs at the callback | The `oauth_verifier` is spent against Discogs over TLS with a signed request. |
| Stolen cookie replayed elsewhere | `__Host-` prefix + `Secure` + `SameSite=Lax` + `Path=/`, no `Domain`. |
| **A stolen cookie used before it expires** | `users.session_version` is sealed into the cookie and checked on every authenticated request. "Sign out everywhere" bumps it, killing every cookie that account holds on their next request. See §6. |
| Claiming another user's data | The internal `user_id` is resolved from the *session's* Discogs username via `ensureUser()`. No route accepts a username or user id as input. |

### Tampering

| Threat | Control |
|---|---|
| Modifying session contents | AEAD. Any bit flip invalidates the tag. |
| **SQL injection** | Every statement uses `$1` placeholders. There is no string concatenation of SQL anywhere in the codebase, and bulk inserts use `unnest($2::text[], …)` rather than building VALUES lists. `lib/db.ts` is the only module that talks to `pg`. |
| Parameter tampering | Every route parses input with a `.strict()` Zod schema — an unexpected property is a **rejected request**, not a silently ignored one. Covered by "rejects an unknown property". |
| Malicious playlist import | Size-capped at 5 MB, then validated field by field by the same server-side schema as any other write. |
| Malicious YouTube URI from Discogs | `youtubeId()` parses with `URL`, checks the host against an allow-list, and requires `^[A-Za-z0-9_-]{11}$`. |
| Bad data reaching the database | Constraints are duplicated in SQL: `clip_key ~ '^[0-9]+:[A-Za-z0-9_-]{11}$'`, `bpm BETWEEN 40 AND 260`, length checks on every text column. Zod is the first line; the database is the last. |
| **A hallucinated record reaching the UI** | The LLM may only reorder candidates the graph found. Every `releaseId` in its response is looked up in the request set; anything else is discarded. See §5. |

### Repudiation

Out of scope for a single-user read-only tool. `llm_usage` records token spend
per user, which doubles as an abuse trail for the only billable operation.
Server logs record error context only, never tokens.

### Information disclosure

| Threat | Control |
|---|---|
| Token exfiltration via XSS | The token is `HttpOnly` and never in `localStorage`. |
| XSS in the first place | CSP `script-src 'self' 'nonce-…' 'strict-dynamic'`, fresh nonce per request, `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`. React escapes all interpolated text; the codebase contains **zero** uses of `dangerouslySetInnerHTML`. |
| Error messages leaking internals | `lib/api.ts` is the only place errors become HTTP. Everything maps to a stable code plus a sentence safe to render; the real error goes to `console.error` server-side. Upstream Discogs and Anthropic bodies are never echoed back. |
| Referrer leakage | `Referrer-Policy: no-referrer`; artwork `<img>` also sets `referrerpolicy="no-referrer"`. |
| Cross-origin reads of API responses | `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` on every `/api/*` response. |
| Secrets in the client bundle | No variable is prefixed `NEXT_PUBLIC_`. CI greps `.next/static` for the build-time secret and fails if it appears. |
| Listening habits leaking between users | The BPM catalogue is keyed `(user_id, clip_key)`. Covered by "another user's catalogue is separate". |

### Denial of service

| Threat | Control |
|---|---|
| One user burning the shared 60 req/min Discogs budget | Sliding-window limits per authenticated user: 12 batch fetches/min, 40 listings/min, 6 analyses/min. The client sync engine self-paces below that and backs off on `429`. |
| Unauthenticated sign-in flood | 10 `/api/auth/login` and 20 `/api/auth/callback` per minute per IP. |
| Hung upstream pinning invocations | `AbortSignal.timeout(15_000)` on Discogs, `45_000` on Anthropic. |
| Connection exhaustion | Pool capped at 3 per isolate, against Neon's pooled endpoint. |
| Unbounded writes | Playlists ≤ 1000 entries, imports ≤ 200 playlists, BPM batches ≤ 200, seeds ≤ 500. |
| **Runaway LLM spend** | Hard per-user ceiling on output tokens per rolling 24h (`LLM_DAILY_OUTPUT_TOKEN_BUDGET`), checked before each call and recorded after. Analyses are cached by content hash, so re-analysing an unchanged playlist costs nothing. |

### Elevation of privilege

| Threat | Control |
|---|---|
| **IDOR** — reading or modifying another user's playlist | Every function in `lib/repo.ts` takes `userId` as its first argument and puts it in the `WHERE` clause. There is no function that accepts a playlist id without also accepting the owner. A foreign playlist **404s rather than 403s**, so the response does not confirm the id exists. Five separate cases in `test-api.mjs` cover this. |
| CSRF | Mutating routes are POST/PATCH/PUT/DELETE only, require `SameSite=Lax` cookies to have been sent, check `Origin` against `APP_ORIGIN`, and require a double-submit token compared in constant time. Enforced centrally by `requireUser(request, { mutating: true })` so a route cannot be written without it. Three cases in `test-api.mjs`. |
| Clickjacking | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. |
| Skewing another user's recommendations | Seed metadata is client-supplied, but is intersected against the playlist's actual contents read from the database. Seeds for releases not in the playlist are discarded — covered by "seeds for releases outside the playlist are ignored". A user can only influence their own analysis. |
| **Writing to another user's Discogs account** | `/api/wantlist` is the only route that changes data on a third-party service. The username used to build the upstream URL comes from the session; the request body accepts nothing but a release id, and `.strict()` rejects an attempt to send a `username` field. Four cases in `test-api.mjs`. |
| Reading or setting another user's deck preference | `/api/prefs` resolves the row from the session's user id; the request body carries nothing but a number. Five cases, including one asserting a second user does not inherit the first's setting. |
| **Overwriting a human's tapped BPM** | Not a classic security issue but the same shape of bug: precedence is enforced in the SQL `ON CONFLICT` clause, not in the client. `tap`/`manual` always beat `auto`. Six cases in `test-api.mjs`. |
| Supply-chain compromise | OAuth 1.0a signing is implemented in-repo (~80 lines) rather than pulled from npm, so no third-party package ever holds the consumer secret. Runtime dependencies total **five**: `next`, `react`, `react-dom`, `zod`, `pg`. The Anthropic call is a plain `fetch`, not an SDK. |

---

## 4. Cryptographic choices

| Decision | Reasoning |
|---|---|
| AES-256-GCM for sessions | Authenticated encryption — a tampered cookie fails closed rather than deserialising attacker-chosen state. |
| 96-bit random IV per seal | GCM's standard nonce size. Random rather than counter-based because serverless isolates share no state. |
| Version prefix `v1.` | Lets the sealing scheme rotate unambiguously; unknown versions are rejected, not guessed. |
| HMAC-SHA1 rather than PLAINTEXT for OAuth | Discogs accepts `PLAINTEXT`, which puts the consumer secret literally in every header. SHA-1 is broken for collision resistance, which HMAC does not depend on. |
| `crypto.getRandomValues` for shuffling | Adequate either way; using the CSPRNG leaves exactly one source of randomness to reason about. |
| `timingSafeEqual` for tokens | CSRF and OAuth tokens compared in constant time. |
| SHA-256 content hash for the analysis cache | Not a security control — a cache key. Stated here so it is not mistaken for one. |
| Rotating `SESSION_SECRET` | Invalidates every session immediately. The intended emergency "log everyone out" lever. |

---

## 5. Playlist privacy

Playlists are private, and the design makes that structural rather than
conventional:

1. **Two openings, both deliberate, both narrow.** A read-only share link
   (one function reads by token, and it returns the tracks and nothing else),
   and collaboration (below). There is no `/public/*` namespace, and
   `test-api.mjs` probes the obvious shapes and asserts they 404.
2. **Every read filters by access.** `listPlaylists`, `getPlaylist` and
   `replaceItems` take the caller's `userId` from the session and put "owns it
   or is a member of it" in the `WHERE` clause, written once as `CAN_EDIT` in
   `repo.ts`. `renamePlaylist`, `deletePlaylist`, the share link and the join
   link keep the stricter `user_id = $n`: owner only. There is no overload
   that omits the user.
3. **A foreign playlist 404s rather than 403s**, so the response does not
   confirm the id exists.
4. **`visibility` is `NOT NULL DEFAULT 'private'`** with a CHECK constraint, and
   the API schemas reject the field outright — a client cannot set or patch it.
   Three cases cover this.

The column exists so that a future opt-in share feature has to be written as a
new repository function that *deliberately* drops the `user_id` predicate. That
is a change that stands out in review, which is the entire point of putting the
flag there before the feature.

### Collaborative playlists

Collaboration is the second deliberate widening, and it widens *who can edit
one playlist*, never what anyone can read about anyone else.

- **Membership, not tokens, grants access.** The join link only gets you to a
  page with a Join button. Pressing it (a POST, with Origin and CSRF checks)
  inserts a `playlist_members` row; from then on access is that row, checked
  in SQL on every request. Previewing a link adds nobody, and shows the name,
  owner and size — not the records.
- **The link.** 32 bytes of CSPRNG output. Stored as its SHA-256 for lookup (a
  256-bit random value has nothing to brute-force from its hash) and, so the
  owner can copy it again without minting a new one, sealed with AES-256-GCM
  under the server key — the same protection as a session cookie. A database
  dump yields no working link. Wrong, malformed and turned-off links are one
  indistinguishable 404. Turning the link off is permanent for that link;
  members already in stay until removed.
- **Roles are fixed and small.** Owner: everything. Collaborator: add
  records, reorder them, take out the ones they added, chat, and leave. The
  rules are one pure function (`collab.can`), tested per action, and the SQL
  enforces the same split —
  owner-only statements never use the membership check.
- **Nobody can remove the owner**, because the owner is not a member row; a
  collaborator can remove only themselves; everyone else asking gets a 404.
- **Concurrent edits cannot silently clobber.** `playlists.version` is checked
  under the row lock in `replaceItems`; an edit made against an older version
  is a 409 and changes nothing.
- **Sign-in round trip.** A join link survives signing in via `?next=`, which
  accepts exactly one shape (`/join/<43-char token>`, `collab.safeNextPath`),
  travels sealed in the OAuth handshake cookie, and is re-validated before the
  redirect. It cannot be turned into an open redirect.
- **Invite-only still decides who has an account.** A join link is not an
  invite code; someone without an account signs in and meets the same door as
  anyone else.
- **Abuse limits.** 50 collaborators per playlist (checked under the same lock
  as the insert); join attempts, link changes and member changes are rate
  limited per user.
- **What it does not do.** Anyone holding a live link who has an account can
  join — that is what a link is. The owner sees who joined, can remove them,
  and can kill the link. Collaborators' BPM catalogues stay their own, so a
  record measured by one person shows no BPM to another until they measure it.

### Chat on collaborative playlists

A message board for the people on one set. It is user-generated content shown
to other users, so it is treated as the most hostile input in the app.

- **Same wall as the records.** Reading, posting and deleting all carry the
  playlist access condition (`CAN_EDIT`) in the SQL statement itself — for a
  post, inside the `INSERT … SELECT`, so there is no gap between "may they?"
  and "they did". A stranger, a malformed id and someone removed a second ago
  all get one indistinguishable 404. A read-only share link never exposes the
  chat.
- **Injection.** Every statement is parameterised; a message is data to
  Postgres whatever it contains. There is no hand-escaping, which would add
  nothing and corrupt what people typed. The message id travels as a decimal
  string, is shape-checked (`chat.isMessageId`) before any query, and is cast
  to BIGINT inside SQL.
- **XSS.** Messages are rendered as React text children — escaped on output.
  No `dangerouslySetInnerHTML`, no Markdown, no auto-linked URLs (so no
  `javascript:` links and no phishing links dressed as buttons). The CSP
  (per-request nonce, no `unsafe-inline` scripts) is the second wall. The API
  tests post `<img src=x onerror=…>` and a `DROP TABLE` and check both come
  back verbatim, as text, with the table still there.
- **Text normalisation, not "sanitising".** `chat.normaliseMessage` stores one
  canonical form: NFC; control characters removed; bidi overrides and
  isolates, zero-width spaces, BOMs and soft hyphens removed (the "Trojan
  Source" trick of text that reads differently from what it is); lone UTF-16
  surrogates replaced; stacks of combining marks capped (no "Zalgo" text drawn
  over the rest of the chat); blank-line runs and line count capped.
- **Length.** 500 characters, counted as code points so the client counter,
  the server check and the database `CHECK (char_length(body) BETWEEN 1 AND
  500)` agree. Over-long messages are refused, never silently cut. The request
  body is capped at 16 KB before parsing, and the schema is strict: a
  client-supplied `author` or anything else extra is a 400. The author always
  comes from the session.
- **Deleting.** The author, or the playlist's owner — one `DELETE … USING
  playlists` whose WHERE clause holds the message, its playlist, the caller's
  access and their right to that message. Any other combination deletes
  nothing and is a 404, so ids cannot be probed.
- **Flooding.** In-memory limits per user (10 posts / 30 s, 90 reads / min)
  as the fast first line, and a count in the database (20 posts per person per
  minute) that holds across every serverless instance. Each playlist keeps
  only its newest 1,000 messages, so no one can make the database hold an
  unbounded amount.
- **Polling, not a realtime service.** An open chat re-reads its latest page
  every 4 s while the tab is visible. No websocket server, third-party pub/sub
  or extra keys — every read goes through the same session, CSRF, rate-limit
  and access checks as the rest of the API. Re-reading the page, rather than
  asking for "everything after id N", also picks up deletions and cannot miss
  a message that committed out of order.
- **Unread state stays in the browser.** The last-seen id is kept in
  `localStorage`, only to draw a dot; it is never sent or trusted.

### Removing records from a shared playlist

Collaborators can add and reorder anything, but can take out only records
they added; the owner can take out any. Edits arrive as the whole list, so the
server works out what was removed itself — per clip key, copies before minus
copies after, compared with who added each copy, under the playlist row lock
(`collab.removalsNotAllowed`). It never trusts the client's idea of what it
removed. Swapping someone's record for another counts as a removal. A refused
edit is a 403 (`not_your_record`) and writes nothing; the UI only offers the
remove button where it would be allowed.

**Digging leaks nothing between users either.** `/api/dig` takes the seed's
metadata and the exclusion lists from the caller, and those only shape what that
caller sees. The `dig_log` table is keyed on `user_id`.

## 6. Session lifetime and revocation

Sessions are stateless: the Discogs token lives inside a sealed cookie and
there is no session table. That is deliberate — a database breach yields no
tokens — but it costs something, and until this release the cost was real: an
exfiltrated cookie stayed valid for its full 14 days, and the only kill switch
was rotating `SESSION_SECRET`, which signs out every user of the deployment.

`users.session_version` closes that without giving up the property that made
stateless sessions worth having.

**How it works.** The version is sealed into the cookie when it is issued and
compared against the stored value on every authenticated request. Bumping the
column invalidates every cookie that account holds, everywhere, on its next
request.

**It costs nothing.** `requireUser` already had to resolve the session's
Discogs username into an internal user id — one `INSERT … ON CONFLICT DO
UPDATE … RETURNING` per request. The version comes back in that same row. No
extra round trip, no session store, no cache to invalidate.

```
cookie  { u: "titomazzetta", v: 3, … }   sealed, HttpOnly, AES-256-GCM
                    │
                    ▼
  INSERT … ON CONFLICT … RETURNING id, session_version    ← already happening
                    │
        v === session_version ?
           yes → userId          no → 401 session_revoked
```

**Order of operations in the guard**, which matters:

1. decrypt and integrity-check the cookie (no database),
2. for a write, verify Origin and the CSRF token,
3. compare against the stored `session_version`.

`getSession()` deliberately does *not* do step 3 — it answers "is this cookie
ours and intact", not "is this session live". Anything calling it directly has
to do the liveness check itself, which is why the server component that renders
the app does so too rather than showing a shell to someone who has signed out.

**What it does not do.** It does not revoke the OAuth grant on Discogs' side —
that lives in the user's Discogs settings and is theirs to revoke. And there is
no per-device revocation, because stateless sessions carry nothing to
distinguish devices by. An all-or-nothing control that says so is better than a
per-device list that quietly does the same thing.

Eleven test cases cover this, including that a cookie from another device dies
too, that every route honours it rather than just the one that was checked
first, that signing back in works immediately, that one account's revoke does
not touch another's, and that revocation kills sessions without touching data.

### Invite-only sign-up

`INVITE_ONLY=true` closes open sign-up. It is a door policy, not a new identity
system: identity is still exactly what Discogs asserts in the OAuth callback.

**Who gets in** is one pure function, `admit` in `src/lib/invite-code.ts`, tested
branch by branch: admins always; existing members always (a code they carry is
left unspent for whoever it was meant for); a removed member only by spending a
fresh code; someone new freely while invite-only is off, and only with a code
while it is on. The callback looks the account up *without* creating it
(`findMember`), asks `admit`, and only then writes anything. A refusal creates
no row and no cookie, and the access token Discogs just granted is dropped.

**The code.** 8 characters from a 31-letter alphabet with look-alikes removed,
drawn with rejection sampling so no letter is favoured: 31⁸ ≈ 8.5 × 10¹¹, about
39.6 bits. That would be thin for a password; it is enough for a credential that
is single-use, lives at most 24 hours (enforced by a table CHECK as well as the
API), is testable only through a 10-per-15-minutes limit per client, and of
which one admin may hold at most 20 live at once.

**Storage.** Only `HMAC-SHA256(k, code)` is stored, where `k` is derived from
`SESSION_SECRET` under a fixed label so the cookie key is never reused for a
second purpose. A database dump yields no usable code. Rotating `SESSION_SECRET`
voids every outstanding code, which is the right behaviour for the emergency
lever and costs nothing since none outlives a day. The plaintext exists in one
HTTP response, marked `no-store`, and in the admin's clipboard.

**Single use** is enforced by Postgres, not by application logic: redemption is
one `UPDATE … SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND
revoked_at IS NULL AND expires_at > now() RETURNING …`, in the same transaction
that creates the member. A concurrent redemption blocks on the row lock,
re-evaluates the predicate against the committed row, and matches nothing.
There is no read-then-write window.

**The code's path.** The invite form POSTs the code in the body (never a URL). It
is shape-checked, hashed, and checked for usability before Discogs is contacted,
then sealed — as its hash — inside the AES-GCM handshake cookie that already
binds the OAuth round trip, so it cannot be swapped on the way back. The POST
has no CSRF token (there is no session yet); Origin is checked instead, and the
worst a forged submission could do is start a sign-in with the attacker's own
code. CSP `form-action` names `https://www.discogs.com` alongside `'self'`,
because browsers apply it to the redirect a form submission follows.

**The admin surface** (`/api/admin/*`) runs `requireUser` first — so a revoked or
absent session gets the usual 401 — then answers anyone not in
`ADMIN_USERNAMES` with a plain 404, not a 403. Writes carry Origin and CSRF
checks and their own rate limits. Revoking is scoped to the admin who made the
code. **Remove member** sets `access_revoked_at` and bumps `session_version` in
one statement, so it takes effect on the member's next request anywhere, and
`resolveSession` refuses a removed account even with a correctly versioned
cookie. Admins are excluded in the `WHERE` clause and cannot be removed.

**What it does not do.** It does not stop a member showing someone the app on
their own device — nothing can. The rate limiter is per instance (see §12), so
a distributed guesser gets more than 10 tries per window; the code space and the
24-hour ceiling are what make that immaterial. `ADMIN_USERNAMES` trusts the
Discogs username, which is as strong as Discogs' own account security.

## 7. The LLM boundary

The optional Claude pass is the one place where model output influences what a
user sees, so it gets its own contract:

> **The model may reorder and explain the candidates the Discogs graph found.
> It may not add to them.**

Mechanically, in `lib/llm.ts`:

1. Candidates are generated first, by graph traversal over real Discogs data.
2. The model receives a compact profile and that candidate list.
3. The response is parsed as JSON and validated with Zod.
4. **Every `releaseId` is looked up in the candidate map. Anything not found, or
   named twice, is dropped.**
5. Anything the model omitted keeps its deterministic position at the end, so a
   terse response never silently loses records.

Any failure at any step — no key, budget exhausted, non-JSON, schema mismatch,
HTTP error, timeout — falls through to the deterministic ordering with
`usedLlm: false`, and the UI says which happened. There is no path where the
feature breaking degrades anything but the prose.

What is sent to Anthropic: aggregate counts of the user's own styles, labels
and artists, plus candidate release titles. No tokens, no email, no username,
no collection listing.

---

## 8. Audio capture

BPM detection uses `getDisplayMedia({ audio: true })`. Because that is a
genuinely powerful permission, the constraints are worth stating:

- **User-initiated only.** It is behind a button; the browser shows its own
  picker and its own persistent "sharing" indicator. There is no way for the
  app to start it silently.
- **The video track is stopped and removed immediately.** Chromium only grants
  tab audio when video is also requested; we never read a pixel.
- **The analyser is not connected to `destination`.** It is a tap, not a
  monitor path — no audio is played back or re-encoded.
- **Nothing leaves the browser.** The capture feeds an onset envelope in
  memory; the only value that reaches the network is an integer BPM.
- **Teardown on unmount, on stop, and on the user revoking sharing** via the
  browser's own UI (`track.onended`).
- Nothing is downloaded from YouTube. This analyses sound the user is already
  legitimately playing, in real time, and stores a number about it.

---

## 9. HTTP response headers

Set in `next.config.ts` (static) and `src/proxy.ts` (per-request CSP).

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'nonce-<random>'
  'strict-dynamic' https:; style-src 'self' 'unsafe-inline'; img-src 'self' data:
  blob: https://i.discogs.com https://img.discogs.com https://i.ytimg.com;
  font-src 'self' data:; connect-src 'self'; frame-src
  https://www.youtube-nocookie.com https://www.youtube.com; media-src 'self' blob:;
  worker-src 'self' blob:; manifest-src 'self'; frame-ancestors 'none';
  base-uri 'none'; form-action 'self'; object-src 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), …
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Two deliberate compromises, stated rather than hidden:

- **`style-src 'unsafe-inline'`.** Next.js emits inline `<style>` tags that
  cannot currently carry a nonce. Scripts — the actual XSS execution vector —
  remain strictly nonce-gated. CSS injection without script execution is a
  defacement and exfiltration-by-selector risk: materially lower, not zero.
- **`Cross-Origin-Embedder-Policy` is omitted.** The YouTube iframe sends no
  CORP headers and would be blocked under COEP, breaking the app entirely.
  COOP is still set.

Note `microphone=()` is **not** in `Permissions-Policy`: mic capture is the
documented fallback for browsers without tab audio capture.

---

## 10. Verifying the claims

```bash
# 1. Headers and per-request nonce (run twice — the nonce must differ)
curl -sS -D - -o /dev/null https://YOUR-APP.vercel.app/ | grep -i 'content-security-policy'

# 2. Every script tag carries a nonce — must print nothing
curl -s https://YOUR-APP.vercel.app/ | grep -o '<script[^>]*>' | grep -v nonce

# 3. No secret reached the client bundle
npm run build && grep -rl "$DISCOGS_CONSUMER_SECRET" .next/static/

# 4. Dependency hygiene
npm run audit:ci && npm ls --prod --depth=0

# 5. Types, lint, and the test suites
npm run typecheck && npm run lint
npm run test:tempo                    # 37 cases, no server needed
npm run test:mixing                   # 34 cases, no server needed
npm run dev & npm run test:api        # 59 cases: auth, CSRF, IDOR, revocation, privacy, validation
```

`test-api.mjs` forges its own session cookies using `SESSION_SECRET` — which is
only possible because the test holds the key. Without it, no session can be
manufactured. That is the sealing guarantee demonstrated rather than asserted.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, the tempo suite, a
Postgres-backed API suite, build, and `npm audit --audit-level=high` on every
push, and fails on any of them.

---

## 11. Build and deployment integrity

Everything above describes the running application. This section is about the
pipeline that produces it, because a threat model that stops at the app's own
code ignores the shortest path to production: the repository.

**Nothing reaches `main` except through a green pull request.** The
`protect-main` ruleset blocks direct pushes, force-pushes and branch deletion,
and requires a pull request whose `verify` and `CodeQL` checks pass.

Required approvals are **0**, and that is a deliberate trade rather than an
oversight. GitHub will not let a maintainer approve their own pull request, so
on a single-maintainer repository any non-zero requirement locks the only
maintainer out of their own `main` — and the predictable outcome is an admin
bypass that gets used every single time, which is not a control but a habit
with a checkbox next to it. The honest configuration is the one that survives
contact with how the repository is actually used: mandatory PR, mandatory green
checks, no force-push, and a review requirement added the day a second
committer exists.

**The repository is public; write access is not.** Anyone can fork and open a
pull request, which is the point of publishing it. Nobody outside the
collaborator list can push a branch, merge, or change a setting. Workflows
triggered by a fork's pull request require maintainer approval before they run,
so an untrusted PR cannot execute CI jobs on its own say-so.

**Workflow tokens are read-only by default.** Both workflows declare
`permissions: contents: read` at the top level; CodeQL adds exactly
`security-events: write` and nothing else. The repository default for
`GITHUB_TOKEN` is *Read repository contents and packages permissions*, so a
workflow that forgets to declare permissions gets the restrictive set, not the
permissive one.

**Third-party actions are pinned to commit SHAs, not tags.** `actions/checkout`
and `github/codeql-action` are referenced by full 40-character SHA with the
human-readable version in a trailing comment. A tag is mutable; a maintainer
(or someone who compromises one) can repoint `v7` at new code and every
consumer silently runs it on their next build. A SHA cannot be repointed.
`persist-credentials: false` on every checkout keeps the token out of
`.git/config` where a later step could read it.

**The build is reproducible from the lockfile.** CI runs `npm ci`, not
`npm install` — the lockfile is authoritative, and a dependency that drifted
fails the job rather than quietly resolving to something newer.

**A build never needs a real secret.** Every credential in CI is a visible
placeholder (see the `env:` block in `ci.yml`). If compiling this app ever
required a production value, that requirement would itself be the vulnerability
— and the pipeline proves the negative on every run by grepping the built
client bundle for the placeholder secret and failing if it appears.

**Scanning runs on a schedule, not just on push.** CodeQL
(`security-and-quality`) runs on every pull request to `main` and again weekly;
`npm audit --audit-level=high` runs in CI and again weekly, so an advisory
disclosed against an already-pinned dependency surfaces even during a quiet
month. Dependabot opens grouped patch/minor PRs weekly and separate PRs for
majors, plus monthly bumps of the pinned action SHAs — pinning is only safe if
something keeps moving the pins. Secret scanning and push protection are on:
a credential committed by mistake is rejected at push time rather than found
later.

These controls have already caught real problems rather than decorating the
repository: `npm audit` blocked the first CI run over two unauthenticated RCEs
in the pinned Next.js version, and CodeQL blocked a pull request of the
author's own over a script that logged the length of a database password.

---

## 12. Residual risks

Honest list of what is *not* solved.

1. **Discogs OAuth has no scopes, so the token we hold can delete.** This is
   the largest residual risk in the design, and it is not fixable from this
   side. OAuth 1.0a as Discogs implements it issues one access token carrying
   the full authority of the account — there is no `scope=collection:read`, and
   no way to request a token that *cannot* `DELETE /users/{u}/collection/...`.
   Every app in the ecosystem holds the same over-broad credential.

   What this app does with that authority is bounded by its own source. There
   are exactly three callers of `writeRequest`:

   | Function | Method | Path |
   |---|---|---|
   | `addToWantlist` | `PUT` | `/users/{u}/wants/{id}` |
   | `removeFromWantlist` | `DELETE` | `/users/{u}/wants/{id}` |
   | `addToCollection` | `POST` | `/users/{u}/collection/folders/1/releases/{id}` |

   So the app is **not** add-only, and an earlier version of this section said
   it was. The wantlist is a toggle — the heart has to be able to turn off, and
   that is a `DELETE`. What holds is narrower and more important: **the
   collection is add-only.** There is no `removeFromCollection` function in the
   codebase — not a guarded one, not an unreachable one; it does not exist, so
   no route, no bug and no crafted request can reach a delete against a
   collection. The `DELETE` that does exist can only ever address
   `/wants/{id}`, because that string is written at its own call site.

   In every case the method is a string literal at the call site, the username
   comes from the sealed session cookie, and the release id is a zod-validated
   positive integer. That is a property you can check rather than trust — the
   source is public; grep `writeRequest` and count the callers.

   What protects the credential itself is that it is never at rest anywhere we
   control. It exists only inside an AES-256-GCM sealed cookie in the user's
   own browser: never written to Postgres, never logged, and never present in
   client JavaScript (`connect-src 'self'` forbids the browser from reaching
   Discogs at all). A total database compromise yields zero tokens. The
   break-glass control is `SESSION_SECRET` rotation, which invalidates every
   sealed cookie in existence on the next deploy — and the backstop that does
   not depend on this app at all is that the user can revoke the application
   from their own Discogs settings.

   *Not solved:* an attacker holding both `SESSION_SECRET` and a user's sealed
   cookie would have a credential that this app's code declines to abuse but
   the Discogs API would honour if sent directly.

2. **The rate limiter is per-instance.** Vercel runs each function in its own
   isolate, so `lib/ratelimit.ts` bounds abuse per instance, not globally. A
   distributed attacker with many sessions can still exceed the Discogs budget.
   *Fix if this took real traffic:* Vercel WAF rate rules, or move the buckets
   to Upstash Redis. Traded away deliberately to keep the deployment simple.

3. **Revocation is all-or-nothing per account.** `session_version` (§6) kills
   every session a user holds, which is the honest primitive for stateless
   sessions but means you cannot sign out one lost phone and keep the laptop.
   Per-device revocation would need per-device identity in the cookie and a
   table to track it — which reintroduces the session store this design
   avoided. A reasonable middle ground, if it ever matters: a `device_label`
   sealed into the cookie and a per-user list of revoked labels.

4. **A revoked session is rejected on its next request, not instantly.**
   There is no push channel; a tab sitting idle stays rendered until it next
   calls the API. In practice that is seconds, but it is not zero.

5. **Database encryption is Neon's, not ours.** Playlists and BPM readings are
   encrypted at rest by the provider but not application-level encrypted. A
   provider-side compromise exposes them. Given the sensitivity (a DJ's track
   list), that was judged acceptable; the Discogs token, which is not
   acceptable to lose, deliberately never goes near the database.

6. **`style-src 'unsafe-inline'`** — see §9.

7. **Third-party trust.** Discogs' TLS and their handling of our consumer
   secret are outside our control, as is Anthropic's handling of prompts.

8. **The YouTube iframe is third-party script** in the user's browser. CSP
   confines it to `frame-src` with no access to our DOM or cookies, but it is
   not nothing.

9. **XSS would still be serious** even though it cannot read the token. An
   attacker with script execution could drive the app's own authenticated
   `fetch` calls. `HttpOnly` limits blast radius; it does not eliminate it.

10. **No formal pen test.** This is one developer's threat model, not an audit.

---

## 13. Reporting

See [SECURITY.md](./SECURITY.md), which GitHub surfaces on the repository's
Security tab. In short: open a private advisory rather than a public issue.
