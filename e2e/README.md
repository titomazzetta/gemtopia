# Browser flows

End-to-end checks in a real Chromium against a built, running Gemtopia — with
Discogs and YouTube faked at the browser, so no account, no token and no
network are needed.

```
# once: the browser
npx playwright install chromium

# the app, with the CI placeholder environment (.github/workflows/ci.yml → env)
export DISCOGS_CONSUMER_KEY=… SESSION_SECRET=… CHAT_MASTER_KEY=… DATABASE_URL=… APP_ORIGIN=http://localhost:3000 …
npm run db:migrate && npm run build && npm run start -- --port 3000 &

# the flows
npm run e2e              # every flow in e2e/flows
npm run e2e -- crate     # one of them
```

Screenshots land in `e2e/out/<flow>/`.

## How it works

- `lib/harness.mjs` seals a session the way `lib/session.ts` does — only
  possible with `SESSION_SECRET`, which is the point — and opens a browser
  context with the cookies, the fake Discogs, the YouTube stub and the welcome
  tour dismissed. `rig.ok(name, condition)` is the whole assertion library.
- `lib/fake-discogs.mjs` answers the app's own `/api/discogs/*`, `/api/dig`,
  `/api/wantlist`, `/api/collection` and `/api/scan` routes from a small
  invented crate: a VA compilation with a different artist on every track, a
  track whose length only its clip knows, a record with no clips, an album
  filed under a "Listening" folder, a double with a copy in two folders, a
  want, and a few strangers for search and Dig. The routes' own code — session, CSRF, validation, limits — is covered
  by `scripts/test-api.mjs`, not here.
- `lib/yt-stub.js` stands in for `https://www.youtube.com/iframe_api` so the
  player reaches "playing" and reports a current time; `window.__ytStub.vid`
  is the clip it was last asked to play.

The flows: `crate` (the rig itself: sync, play, search), `usability` (search
by artist, the wantlist heart, a compilation's rows, picking up where you
left off after a reload), `folders` (the Folder filter: only / hide, doubles,
the standing choice) and `scan` (photos to cards, playing a track before
adding it, ticks and titles as separate targets, adds in photo order).

A flow is a file in `flows/` exporting one `async function` that returns
`true` when every check passed. Keep flows independent of each other: each
opens its own contexts and uses its own usernames.
