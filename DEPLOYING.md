# Deploying Gemtopia

Eleven steps in the order that avoids the one trap in the sequence, then a
checklist for the first fifteen minutes of actually using it.

Run it locally first — you can be signed in and shuffling in about fifteen
minutes, and deploying something you've already seen work is a much shorter
debugging session.

- **~20 min** setup
- **~12 min** first sync, in the background
- **£0** — Neon, Vercel and Discogs free tiers
- **Node 22** required (`.nvmrc` pins it)

---

## Gather three things first

None of these depend on each other. Get all three and the rest is pasting.

### 1. A Neon connection string

Sign up at [neon.com](https://neon.com), create a project, name the database
`gemtopia`.

Hit **Connect** on the project dashboard and make sure **Connection pooling** is
toggled on — the hostname you copy must contain `-pooler`. Serverless functions
open and drop connections constantly and will exhaust a direct endpoint.

### 2. A session signing key

```bash
npm install
npm run keygen
```

Copy the 43-character value. This encrypts your session cookie; changing it later
signs everyone out, which is the intended panic button.

### 3. A Discogs application

[discogs.com/settings/developers](https://www.discogs.com/settings/developers) →
**Create an application**. Call it `Gemtopia (local)`.

Callback URL, exactly:

```
http://localhost:3000/api/auth/callback
```

Copy the **Consumer Key** and **Consumer Secret**.

---

## Why two Discogs applications

A Discogs application has a single Callback URL field, and your Vercel URL
doesn't exist until you've deployed — which looks like a chicken-and-egg
problem. It mostly isn't, and it's worth knowing why before you go hunting for
a bug that isn't there.

Gemtopia sends `oauth_callback` on every request-token call, derived from
`APP_ORIGIN` (`discogs.ts`, `requestToken`). Discogs' own note on the form says
the same thing: *OAuth 1.0a applications should provide an `oauth_callback`
during the request token step regardless of what's entered here.* So the
registered field is largely advisory, and the value that actually governs the
redirect is the one your deployment sends at sign-in time.

**Make two applications anyway** — `Gemtopia (local)` now, `Gemtopia` once you
have the real URL — for a better reason than the callback field:

> Separate credentials for local and production means a consumer secret that has
> been sitting in a `.env.local` on a laptop, in a shell history, or in a
> screen-share cannot be used against your live deployment. Revoking the local
> one costs you nothing.

The setting that must be right in production is **`APP_ORIGIN`**. It has to be
your real origin, exactly — `https://`, no trailing slash. That is what builds
the callback, and it is what the CSRF and Origin checks compare against. A wrong
`APP_ORIGIN` is the single most common cause of sign-in failing, and neither
Discogs nor the app will tell you in so many words that it is what went wrong.

Before debugging anything else, prove your credentials are sound:

```bash
npm run verify:discogs .env.local
```

It signs a real request-token call and tells you PASS or FAIL without printing
your key or secret. If that passes and sign-in still fails, the problem is
`APP_ORIGIN` — not the credentials.

---

## Run it on your laptop

Same Neon database production will use, so there's no local Postgres to install.

### Step 1 — Write your environment file

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```bash
DISCOGS_CONSUMER_KEY=your-key
DISCOGS_CONSUMER_SECRET=your-secret
DISCOGS_CONTACT=+https://github.com/titomazzetta/gemtopia
SESSION_SECRET=the-keygen-output
APP_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://...-pooler...neon.tech/gemtopia?sslmode=require
```

`.env.local` is already in `.gitignore`. It will never be committed.

### Step 2 — Create the tables

```bash
npm run db:migrate
```

It prints the seven tables it created. The schema is idempotent, so re-running is
always safe.

### Step 3 — Prove it works before you trust it

```bash
npm run verify:discogs .env.local   # real OAuth handshake, PASS or FAIL
npm run test:env                    # 36 cases — your configuration contract
npm run test:headers                # 20 cases — security headers, both ways
npm run test:tempo                  # 37 cases
npm run test:mixing                 # 55 cases
```

None of them needs a server, and `verify:discogs` needs no dependencies either —
it runs before `npm install` finishes.

Run `verify:discogs` first. It signs a genuine request-token call against
Discogs and tells you whether your key and secret are sound, without printing
them. Getting a PASS here means every later sign-in failure is an origin or
callback problem, which is a different bug in a different place. Skipping it
means an afternoon of not knowing which of the two you have.

The other two are optional, but if the beatmatch maths or the tempo estimator
are unhappy on your machine, better to know now than mid-set.

### Step 4 — Start it

```bash
npm run dev
```

Open `http://localhost:3000` and click **Sign in with Discogs**. You'll authorise
on Discogs and get bounced back signed in.

The sync starts on its own. A 1,500-record collection takes **10–12 minutes** —
that's Discogs' 60-requests-per-minute limit, not the app being slow. Everything
already loaded is usable while it runs, and closing the tab doesn't lose progress.

### Step 5 — Optional: the written analysis

Everything works without this. An [Anthropic API key](https://console.anthropic.com)
adds the prose characterisation to playlist analysis and reorders the
recommendations — it cannot invent records the Discogs graph didn't find.

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Costs pennies per analysis, with a per-user daily token ceiling built in.

Leaving the line blank is fine and is the supported way to run without it —
`ANTHROPIC_API_KEY=` with nothing after it means *absent*, not *invalid*. The
same holds for every optional key in `.env.example`.

---

## Put it on the internet

### Step 6 — Push to GitHub

Twelve commits of history are already here. One command:

```bash
gh repo create gemtopia --public --source=. --remote=origin --push
```

No `gh`? Create an empty repo at [github.com/new](https://github.com/new) — no
README, licence or gitignore, this repo has them — then:

```bash
git remote add origin https://github.com/titomazzetta/gemtopia.git
git branch -M main
git push -u origin main
```

### Step 7 — Turn on push protection

**Settings → Code security** → enable **Secret scanning** and **Push protection**.

Push protection is the one that matters: it blocks a commit containing a
credential *before* it reaches the remote, rather than telling you afterwards. Do
it now, while the repo is empty of mistakes.

### Step 8 — Import to Vercel and let the first build fail

**vercel.com → Add New → Project**. Import `gemtopia` and deploy without setting
anything.

**The build will fail.** That is correct and it is the point: the app validates
its configuration at build time (`src/lib/env.ts`), so a misconfigured deploy dies
loudly instead of returning 500s to users later.

What you wanted from this deploy is the URL. Vercel now shows your production
domain — probably `https://gemtopia.vercel.app`, or with a suffix if that name was
taken. Copy it exactly.

### Step 9 — Make the second Discogs application

**Create an application** again, call it `Gemtopia (production)`, and set the
callback to your real URL plus the callback path:

```
https://your-app.vercel.app/api/auth/callback
```

No trailing slash, and `https` not `http`.

### Step 10 — Set the environment

**Vercel → your project → Settings → Environment Variables**, scoped to
**Production**.

Use the *new* Discogs credentials, a *fresh* `SESSION_SECRET` (run `npm run keygen`
again — don't reuse your local one), and the same Neon string.

| Variable | Required | Value |
|---|---|---|
| `DISCOGS_CONSUMER_KEY` | yes | From the production Discogs app |
| `DISCOGS_CONSUMER_SECRET` | yes | From the production Discogs app |
| `SESSION_SECRET` | yes | A fresh `npm run keygen` output |
| `APP_ORIGIN` | yes | Your URL, **no trailing slash** |
| `DATABASE_URL` | yes | The Neon `-pooler` string |
| `DISCOGS_CONTACT` | advised | A URL or email — Discogs requires a contact in the User-Agent |
| `ANTHROPIC_API_KEY` | optional | Enables the written playlist analysis |
| `ANTHROPIC_MODEL` | optional | Defaults to `claude-sonnet-4-5` |
| `LLM_DAILY_OUTPUT_TOKEN_BUDGET` | optional | Defaults to 40,000 per user per day |

Then **Deployments → ⋯ → Redeploy**. This one should go green.

### Step 11 — Migrate, if you skipped local

If you ran step 2 against the same Neon database, the tables exist and you're
done. Otherwise:

```bash
DATABASE_URL="your-pooler-string" npm run db:migrate
```

Open your URL and sign in. Because it's a different Discogs application, this is a
separate authorisation from your local one — expect to approve it again.

---

## What GitHub is actually doing

Three separate jobs, and only one of them is "storing the code".

| Role | What it means |
|---|---|
| **Source** | The commit history lives here. |
| **Trigger** | Vercel subscribes to the repo. Push to `main` → production redeploys, no CLI needed. Any other branch or PR → a **preview deployment** on its own URL. |
| **Scrutiny** | Actions runs CI on every push: typecheck, lint, `npm audit`, the offline and API test suites against a throwaway Postgres, a production build, and a grep proving no server-only secret reached the client bundle. CodeQL on every pull request and weekly; Dependabot for dependency PRs. Current test counts live in the README, in one place, so this line cannot fall behind them again. |

### CI gates the deploy — because main is protected

GitHub Actions and Vercel's build are separate pipelines watching the same push,
and Vercel will ship a push to `main` whatever CI says. What stops a red build
reaching production is that nothing reaches `main` except through a pull request
that has already passed.

This repository does that with a ruleset, `protect-main`: changes arrive by pull
request only, `verify` and `CodeQL` must both pass before a merge, and
force-pushes and branch deletion are refused. If you fork it, recreate that —
**Settings → Rules → Rulesets → New branch ruleset** on `main` — because without
it a broken test is just a notification you learn to ignore, and a red check can
sit beside a green deploy.

### ⚠ Sign-in won't work on preview deployments

Every preview gets a unique URL like `gemtopia-a1b2c3-tito.vercel.app`, but your
Discogs application holds one callback and `APP_ORIGIN` is one fixed value. So a
preview renders fine and the sign-in button just fails — nothing is broken, the
URLs simply don't match.

For a solo project that's fine: use previews to confirm it *builds* and the
logged-out page looks right, and test signed-in behaviour locally or on
production. If you want a working signed-in preview, Vercel gives branch
deployments a *stable* alias — register a third Discogs app against that exact
host and set `APP_ORIGIN` for the Preview environment only.

### One thing to keep straight

**Vercel builds from GitHub, not from your laptop.** If a deploy doesn't reflect a
change, check the commit actually pushed before you go looking at Vercel. And
environment variables live in Vercel, never in the repo — `.env.local` is
gitignored, and the build fails loudly rather than falling back to a default.

---

## Your first fifteen minutes

In this order — each exercises a different subsystem, and the later ones need data
the earlier ones produce.

- [ ] **Let the sync finish, then check the filter panel.** Every chip should be a
      genre, style, label and artist you recognise from your own shelves, with
      counts. If you see styles you don't own, something is wrong.
- [ ] **Hit `S` to shuffle the whole crate.** Confirm audio plays, and that the
      same release doesn't come up twice in a row.
- [ ] **Tap `T` in time with a track, eight or nine times.** A BPM appears and
      sticks. This writes to Postgres — reload and it should still be there.
- [ ] **In Chrome or Edge, turn on `auto` in the player.** Pick this tab and tick
      *Share tab audio*. Leave it running while you listen — BPMs fill in on their
      own. Firefox and Safari can't do this; use the mic button or keep tapping.
- [ ] **Press `D` on something good.** Click a label chip to re-cut the crate.
      Then switch to *Beyond your crate*, preview a record you don't own, and add
      one to your wantlist — check it actually appears on Discogs.
- [ ] **Build a playlist of six or seven tracks with `A`.** Tap BPMs into all of
      them, then open the playlist and read the transition strips. Try **Smooth
      order**.
- [ ] **Switch the deck picker to ±16.** Transitions that were amber at ±8 should
      go green. That's the pitch-range model doing its job.
- [ ] **Run Insights on that playlist.** Takes a few seconds — real Discogs calls.
      Every recommendation should name the relationship that found it.
- [ ] **Sign in on your phone, then Sign out everywhere from the laptop.** The
      phone drops to the sign-in screen on its next action. Sign back in — works
      immediately.

---

## Looks broken, isn't

| What you'll see | Why |
|---|---|
| The first Vercel build fails | Configuration is validated at build time and you deployed before setting it. Intentional — see step 8. |
| Records with no audio at all | Discogs' video data is patchy and some releases simply have none. Nothing to fix at this end. |
| Clips that skip after a second | That YouTube video is private, deleted, or region-blocked. The player detects it and moves on. |
| Jungle reading 87 instead of 174 | A half-time snare pattern genuinely describes 87, and every tempo estimator splits on which to report. Hit **×2**, or tap it — a tap always wins. |
| Sign-in fails on a preview URL | Expected. See *Sign-in won't work on preview deployments* above. |

---

## When something actually breaks

| Symptom | Cause | Fix |
|---|---|---|
| Sign-in bounces back with an error | Callback URL mismatch, nine times out of ten | Discogs callback must equal `APP_ORIGIN` + `/api/auth/callback`, character for character. Check for a trailing slash and `http` vs `https`. |
| Build fails naming a variable | Missing or malformed config | The message says which one. `SESSION_SECRET` must decode to exactly 32 bytes — regenerate with `npm run keygen` rather than inventing one. |
| Timeouts, or "too many connections" | Direct Neon endpoint instead of pooled | `DATABASE_URL` must contain `-pooler`. Re-copy from Neon with the pooling toggle on. |
| Sync stalls and resumes | Discogs rate limit | Working as designed. It backs off and continues; the progress bar shows where it's up to. |
| Auto BPM finds no audio | Tab audio wasn't shared | Re-run it and tick *Share tab audio* in the picker. Chromium browsers only. |
| Everything 401s suddenly | Session revoked, or `SESSION_SECRET` changed | Sign in again. Changing that variable invalidates every session by design. |
| `npm test` fails on an unknown flag | Node older than 22.6 | The pure-logic suites use Node's built-in type stripping. `nvm use` picks up `.nvmrc`. |

---

## Before you share the URL widely

The rate limiter is per serverless instance, which bounds abuse per instance
rather than globally — fine for you and a few friends, thin if the link travels.
Vercel's WAF rate rules are the cheapest fix.

It's written up as a residual risk in [THREAT_MODEL.md](./THREAT_MODEL.md), along
with everything else that is known and deliberately unmitigated.

---

**See also:** [README.md](./README.md) for what the app does and how it's built ·
[THREAT_MODEL.md](./THREAT_MODEL.md) for the threat model ·
[SECURITY.md](./SECURITY.md) to report a vulnerability.
