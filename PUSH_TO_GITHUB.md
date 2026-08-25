# Getting this onto GitHub

The sandbox this was built in has a GitHub token scoped to pre-configured
repositories only — `POST /user/repos` returns 403 — so the repo could not be
created for you. Everything else is done: three commits of history, CI, CodeQL,
Dependabot, licence, and a `.gitignore` that already excludes `.env.local`.

## Option A — GitHub CLI (one command)

```bash
cd playtopia
gh repo create playtopia --public --source=. --remote=origin --push
```

## Option B — web UI

1. Create an empty repo at <https://github.com/new> named `playtopia`.
   **Do not** add a README, licence or .gitignore — this repo has them.
2. Then:

```bash
cd playtopia
git remote add origin https://github.com/titomazzetta/playtopia.git
git branch -M main
git push -u origin main
```

## Right after the first push

**1. Turn on secret scanning and push protection**
Settings → Code security → enable *Secret scanning* and *Push protection*.
Push protection is the one that matters: it blocks a commit containing a
credential before it ever reaches the remote.

**2. Check CodeQL ran**
The Actions tab should show *CI* and *CodeQL*. CI needs no secrets — it spins up
its own Postgres service and uses placeholder env values, by design.

**3. Protect `main`**
Settings → Branches → add a rule for `main` requiring the CI check to pass.
Worth doing even solo: it means a red build can't land silently.

**4. Confirm nothing sensitive is public**

```bash
git log --all --oneline -- .env.local     # must print nothing
git grep -n "DISCOGS_CONSUMER_SECRET" -- . ':!*.md' ':!.env.example'
```

The second should only match `src/lib/env.ts` and `src/lib/discogs.ts`, where the
name is read from `process.env` — never a value.

## Deploying from the repo

Vercel → Add New Project → import `playtopia`. Then set the environment variables
listed in the README, run `npm run db:migrate` against your Neon database, and
redeploy. Every push to `main` deploys automatically after that.
