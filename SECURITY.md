# Security Design

CrateShuffle holds a third-party OAuth credential that grants read access to a
user's Discogs account, and it renders data written by strangers (release
titles, video titles, playlist exports). Those two facts drive every decision
below.

This document states what is defended, how, and — just as importantly — what is
**not** defended and why.

---

## 1. Trust boundaries

```
┌─ Untrusted ─────────────────────────────────────────────────────────┐
│  The browser, everything in it, and every byte it sends us.         │
│  Discogs API responses (user-generated text, arbitrary URLs).       │
│  Imported playlist JSON files.                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ══════════╪══════════  ← boundary A: HTTP request
                              │
┌─ Trusted ───────────────────────────────────────────────────────────┐
│  Vercel serverless functions.                                       │
│  Environment variables (consumer secret, session key).              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                    ══════════╪══════════  ← boundary B: signed egress
                              │
┌─ Third party ───────────────────────────────────────────────────────┐
│  api.discogs.com  (OAuth 1.0a, HMAC-SHA1)                           │
│  youtube-nocookie.com (sandboxed iframe, no data flows out)         │
└─────────────────────────────────────────────────────────────────────┘
```

**Key property:** the browser never crosses boundary B. It cannot reach Discogs
directly — CSP `connect-src 'self'` forbids it — so there is no code path in
which an access token or the consumer secret exists in client JavaScript.

---

## 2. Assets

| Asset | Sensitivity | Where it lives |
|---|---|---|
| Discogs consumer secret | **Critical** — compromises every user of the app | Vercel env var, server memory only |
| `SESSION_SECRET` (AES key) | **Critical** — forges arbitrary sessions | Vercel env var, server memory only |
| User's Discogs access token + secret | **High** — read access to their account | AES-256-GCM sealed cookie, browser only |
| Collection index, playlists | Low | User's IndexedDB |
| Username | Low | Inside the sealed cookie |

There is **no server-side datastore**. Nothing about a user persists on
infrastructure we control. This is the single largest risk reduction in the
design: a full compromise of the deployment yields the two env vars and
nothing else — no user table, no token store, no backups.

---

## 3. STRIDE

### Spoofing

| Threat | Control |
|---|---|
| Forged session cookie | Sessions are AES-256-GCM sealed. GCM's auth tag means a tampered or fabricated cookie fails to decrypt; `unseal()` returns `null` and the request is unauthenticated. Forgery requires the 32-byte key. |
| Session fixation via the OAuth callback | The request token is sealed into a single-use, HttpOnly, 10-minute cookie. The callback refuses unless the `oauth_token` Discogs returns matches it (`safeEqual`, constant time). An attacker cannot plant a handshake in the victim's browser, so they cannot bind their Discogs account to the victim's session. RFC 5849 §11.7. |
| Impersonating Discogs at the callback | The `oauth_verifier` is spent against Discogs over TLS with a signed request. A bogus verifier yields no access token. |
| Stolen cookie replayed elsewhere | `__Host-` prefix + `Secure` + `SameSite=Lax` + `Path=/`, no `Domain` — the cookie is bound to the exact origin and never sent cross-site or over plaintext. |

### Tampering

| Threat | Control |
|---|---|
| Modifying session contents (e.g. swapping the username) | AEAD. Any bit flip invalidates the tag. |
| Parameter tampering on API routes | Every route parses its input with a Zod schema and rejects on failure. Pagination is bounded (`page ≤ 500`, `perPage ≤ 100`); release IDs must be positive integers, deduplicated, max 8 per batch. |
| Malicious playlist import | Imports are size-capped (5 MB), parsed defensively, and **allow-listed field by field** — only `name` (truncated to 80 chars) and `items` matching `/^\d+:[A-Za-z0-9_-]{11}$/` survive. Unknown objects are never spread into stored state. |
| Malicious YouTube URI from Discogs | `youtubeId()` parses with `URL`, checks the host against an allow-list, and requires the ID match `^[A-Za-z0-9_-]{11}$`. Anything else is dropped rather than passed to the player. |

### Repudiation

Out of scope. Single-user-per-session read-only app; no audit trail is required
because no destructive action is possible through it. Server logs record error
context only, never tokens.

### Information disclosure

| Threat | Control |
|---|---|
| Token exfiltration via XSS | The token is `HttpOnly` and never in `localStorage`, so script cannot read it. |
| XSS in the first place | CSP `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce per request. No `unsafe-inline` scripts. `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`. React escapes all interpolated text and the app contains **zero** uses of `dangerouslySetInnerHTML`. |
| Error messages leaking internals | `lib/api.ts` is the only place errors become HTTP. It maps everything to a stable code plus a sentence safe to render; the real error goes to `console.error` server-side. Upstream Discogs bodies are never echoed back. |
| Referrer leakage | `Referrer-Policy: no-referrer`; artwork `<img>` tags additionally set `referrerpolicy="no-referrer"`. |
| Tracking by YouTube on page load | Player host is `youtube-nocookie.com` and the iframe is only created when the app mounts. |
| Cross-origin reads of API responses | `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` on every `/api/*` response. |
| Secrets in the client bundle | No variable is prefixed `NEXT_PUBLIC_`, so Next.js will not inline them. Verified by grepping `.next/static` — see §6. |

### Denial of service

| Threat | Control |
|---|---|
| One user burning the shared 60 req/min Discogs budget | Sliding-window limiter: 12 batch requests/min and 40 listing requests/min per authenticated user. The client sync engine self-paces well below that and backs off on `429` with `Retry-After`. |
| Unauthenticated sign-in flood | 10 `/api/auth/login` and 20 `/api/auth/callback` per minute per IP. |
| Hung upstream pinning invocations | Every Discogs fetch carries `AbortSignal.timeout(15_000)`. |
| Limiter map growth from rotating identifiers | Bucket map is capped at 10,000 keys with oldest-half eviction. |

### Elevation of privilege

| Threat | Control |
|---|---|
| **IDOR** — reading another user's collection through our credentials | The Discogs username is read from the *session*, never from a query parameter. There is no route that accepts a username as input. This is the single most important line of authorisation code in the app. |
| CSRF on state-changing routes | Logout is POST-only, requires `SameSite=Lax` cookies to have been sent, checks `Origin` against `APP_ORIGIN`, and requires a double-submit token (`x-csrf-token` header matched constant-time against a non-HttpOnly cookie). |
| Clickjacking into a state change | `frame-ancestors 'none'` + `X-Frame-Options: DENY`. |
| Supply-chain compromise via an OAuth library | OAuth 1.0a signing is ~80 lines and is implemented in-repo (`lib/oauth1.ts`) rather than pulled from npm. Runtime dependencies total **four**: `next`, `react`, `react-dom`, `zod`. |

---

## 4. Cryptographic choices

| Decision | Reasoning |
|---|---|
| AES-256-GCM for sessions | Authenticated encryption. Confidentiality *and* integrity in one primitive, so a tampered cookie fails closed rather than deserialising attacker-chosen state. |
| 96-bit random IV per seal | The GCM standard nonce size. Random rather than counter-based because serverless instances share no state and so cannot coordinate a counter. |
| Version prefix `v1.` on sealed tokens | Lets the sealing scheme be rotated without ambiguity; unknown versions are rejected rather than guessed. |
| HMAC-SHA1 rather than PLAINTEXT for OAuth | Discogs accepts `PLAINTEXT`, which puts the consumer secret literally in the header on every request. SHA-1 is broken for collision resistance, which HMAC does not depend on; HMAC-SHA1 remains sound and is what OAuth 1.0a specifies. |
| `crypto.getRandomValues` for shuffling | `Math.random()` would be adequate for a playlist. Using the CSPRNG costs nothing and leaves exactly one source of randomness in the codebase to reason about. |
| `timingSafeEqual` for tokens | CSRF tokens and OAuth tokens are compared in constant time so comparison latency reveals nothing about the correct value. |
| Rotating `SESSION_SECRET` | Invalidates every session immediately. This is the intended emergency "log everyone out" lever. |

---

## 5. HTTP response headers

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
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), …
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Two deliberate compromises, stated rather than hidden:

- **`style-src 'unsafe-inline'`.** Next.js emits a small number of inline
  `<style>` tags that cannot currently carry a nonce. Scripts — the actual XSS
  execution vector — remain strictly nonce-gated. CSS injection without script
  execution is a defacement and data-exfiltration-by-selector risk, which is
  materially lower but not zero.
- **`Cross-Origin-Embedder-Policy` is omitted.** The YouTube iframe does not
  send `Cross-Origin-Resource-Policy` headers and would be blocked under COEP,
  which would break the entire application. COOP is still set, so the app is
  isolated from opener-based attacks.

---

## 6. Verifying the claims

Everything above is checkable in about a minute.

```bash
# 1. Headers and per-request nonce
curl -sS -D - -o /dev/null https://YOUR-APP.vercel.app/ | grep -i 'content-security-policy\|strict-transport'
#    Run twice — the nonce must differ.

# 2. Every script tag carries a nonce
curl -s https://YOUR-APP.vercel.app/ | grep -o '<script[^>]*>' | grep -v nonce
#    Must print nothing.

# 3. No secret reached the client bundle
npm run build
grep -rl "$DISCOGS_CONSUMER_SECRET" .next/static/   # must print nothing

# 4. Dependency hygiene
npm run audit:ci      # 0 vulnerabilities at high or above
npm ls --prod --depth=0

# 5. Types and lint
npm run typecheck && npm run lint
```

The token is `HttpOnly` — confirm in DevTools that
`document.cookie` in the console shows only the CSRF token, never the session.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, build, and
`npm audit --audit-level=high` on every push, and fails the build on any of them.

---

## 7. Residual risks

Honest list of what is *not* solved.

1. **The rate limiter is per-instance.** Vercel runs each function in its own
   isolate, so `lib/ratelimit.ts` bounds abuse per instance, not globally. A
   distributed attacker with many sessions can still exceed the Discogs budget.
   *Mitigation if this app took real traffic:* Vercel WAF rate rules, or move
   the buckets to Upstash Redis. This was traded away deliberately to keep the
   deployment dependency-free.

2. **No token revocation list.** Sessions are stateless, so an exfiltrated
   cookie is valid until its 14-day expiry. There is no per-session kill switch
   — only rotating `SESSION_SECRET`, which logs out everybody. Adding one means
   adding a datastore and giving up the "no user data at rest" property.

3. **`style-src 'unsafe-inline'`** — see §5.

4. **Discogs' TLS and their handling of our consumer secret** are outside our
   control. If Discogs is compromised, our users' data is compromised.

5. **The YouTube iframe is a third-party origin** running third-party script in
   the user's browser. CSP confines it to `frame-src` and it has no access to
   our DOM or cookies, but it is not nothing.

6. **XSS would still be serious even though it cannot read the token.** An
   attacker with script execution could drive the app's own authenticated
   `fetch` calls and read the collection. `HttpOnly` limits blast radius; it
   does not eliminate it.

7. **No formal pen test.** This is one developer's threat model, not an audit.

---

## 8. Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.
