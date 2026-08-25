#!/usr/bin/env node
/**
 * API integration tests.
 *
 * Runs against a live dev server and a real Postgres. Exercises the parts that
 * are easy to get subtly wrong and expensive to get wrong in production:
 * authentication, CSRF, cross-user isolation (IDOR), input validation, and the
 * BPM precedence rules that live in SQL.
 *
 *   BASE=http://localhost:3222 npm run test:api
 *
 * Sessions are forged locally with the same AES-256-GCM sealing the app uses —
 * which is only possible because we hold SESSION_SECRET. That is the point:
 * without it, no session can be manufactured.
 */

import { strict as assert } from "node:assert";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

try {
  const envFile = readFileSync(join(here, "..", ".env.local"), "utf8");
  for (const line of envFile.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  /* env supplied externally */
}

const BASE = process.env.BASE ?? "http://localhost:3222";
const KEY = Buffer.from(process.env.SESSION_SECRET ?? "", "base64url");
assert.equal(KEY.length, 32, "SESSION_SECRET must decode to 32 bytes");

let failures = 0;
let ran = 0;

async function check(name, fn) {
  ran += 1;
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${error.message}`);
  }
}

function seal(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    ct.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** A signed-in browser, as far as the server is concerned. */
function actor(username) {
  const csrf = `csrf-${username}-${randomBytes(6).toString("hex")}`;
  const session = seal({
    t: "token",
    s: "secret",
    u: username,
    iat: Math.floor(Date.now() / 1000),
  });

  return {
    username,
    csrf,
    cookie: `pt_session=${session}; pt_csrf=${csrf}`,
    async call(path, { method = "GET", body, csrfToken, cookie } = {}) {
      const headers = { accept: "application/json" };
      const jar = cookie === undefined ? this.cookie : cookie;
      if (jar) headers.cookie = jar;
      if (body !== undefined) headers["content-type"] = "application/json";

      const token = csrfToken === undefined ? this.csrf : csrfToken;
      if (method !== "GET" && token !== null) headers["x-csrf-token"] = token;

      const response = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body */
      }
      return { status: response.status, body: json, raw: text };
    },
  };
}

const alice = actor(`alice_${randomBytes(4).toString("hex")}`);
const mallory = actor(`mallory_${randomBytes(4).toString("hex")}`);

const clip = (releaseId, video) => ({
  clipKey: `${releaseId}:${video}`,
  releaseId,
  videoId: video,
  title: "Test Track",
  artist: "Test Artist",
  releaseTitle: "Test Release",
  year: 1996,
});

console.log(`\nAPI integration tests against ${BASE}\n`);
console.log("authentication");

await check("anonymous GET /api/playlists is 401", async () => {
  const res = await alice.call("/api/playlists", { cookie: "" });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "unauthenticated");
});

await check("a tampered session cookie is rejected", async () => {
  const tampered = alice.cookie.replace(/pt_session=v1\.[^.]+\./, "pt_session=v1.AAAAAAAAAAAAAAAA.");
  const res = await alice.call("/api/playlists", { cookie: tampered });
  assert.equal(res.status, 401);
});

await check("a valid session can list playlists", async () => {
  const res = await alice.call("/api/playlists");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.playlists));
});

console.log("\nCSRF");

await check("POST without a CSRF token is 403", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "nope" },
    csrfToken: null,
  });
  assert.equal(res.status, 403);
});

await check("POST with the wrong CSRF token is 403", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "nope" },
    csrfToken: "not-the-right-token",
  });
  assert.equal(res.status, 403);
});

await check("cross-origin POST is refused", async () => {
  const response = await fetch(`${BASE}/api/playlists`, {
    method: "POST",
    headers: {
      cookie: alice.cookie,
      "content-type": "application/json",
      "x-csrf-token": alice.csrf,
      origin: "https://evil.example",
    },
    body: JSON.stringify({ name: "nope" }),
  });
  assert.equal(response.status, 403);
});

console.log("\nplaylist CRUD");

let alicePlaylistId = null;

await check("create a playlist", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "Warehouse", entries: [clip(1001, "aaaaaaaaaaa")] },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.playlist.name, "Warehouse");
  assert.equal(res.body.playlist.items.length, 1);
  alicePlaylistId = res.body.playlist.id;
});

await check("append and reorder through PATCH", async () => {
  const res = await alice.call(`/api/playlists/${alicePlaylistId}`, {
    method: "PATCH",
    body: {
      entries: [
        clip(1002, "bbbbbbbbbbb"),
        clip(1001, "aaaaaaaaaaa"),
        clip(1003, "ccccccccccc"),
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.playlist.items, [
    "1002:bbbbbbbbbbb",
    "1001:aaaaaaaaaaa",
    "1003:ccccccccccc",
  ]);
});

await check("rename", async () => {
  const res = await alice.call(`/api/playlists/${alicePlaylistId}`, {
    method: "PATCH",
    body: { name: "Warehouse — late" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.playlist.name, "Warehouse — late");
  assert.equal(res.body.playlist.items.length, 3, "rename must not drop items");
});

console.log("\ncross-user isolation (IDOR)");

await check("another user cannot read it", async () => {
  const res = await mallory.call(`/api/playlists/${alicePlaylistId}`);
  assert.equal(res.status, 404, "should 404, not 403 — do not confirm it exists");
});

await check("another user cannot modify it", async () => {
  const res = await mallory.call(`/api/playlists/${alicePlaylistId}`, {
    method: "PATCH",
    body: { name: "pwned" },
  });
  assert.equal(res.status, 404);
});

await check("another user cannot delete it", async () => {
  const res = await mallory.call(`/api/playlists/${alicePlaylistId}`, {
    method: "DELETE",
  });
  assert.equal(res.status, 404);
});

await check("...and it is genuinely untouched", async () => {
  const res = await alice.call(`/api/playlists/${alicePlaylistId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.playlist.name, "Warehouse — late");
});

await check("another user cannot analyse it", async () => {
  const res = await mallory.call("/api/insights", {
    method: "POST",
    body: {
      playlistId: alicePlaylistId,
      refresh: false,
      seeds: [],
      ownedReleaseIds: [],
      wantlistReleaseIds: [],
    },
  });
  assert.equal(res.status, 404);
});

await check("another user's playlist list is empty of it", async () => {
  const res = await mallory.call("/api/playlists");
  assert.equal(res.status, 200);
  assert.ok(
    !res.body.playlists.some((p) => p.id === alicePlaylistId),
    "leaked into another user's listing",
  );
});

console.log("\ninput validation");

await check("rejects a malformed clip key", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: {
      name: "bad",
      entries: [{ ...clip(1, "aaaaaaaaaaa"), clipKey: "not-a-clip-key" }],
    },
  });
  assert.equal(res.status, 400);
});

await check("rejects an unknown property", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "bad", isAdmin: true },
  });
  assert.equal(res.status, 400, "strict schemas must reject extra keys");
});

await check("rejects an over-long name", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "x".repeat(500) },
  });
  assert.equal(res.status, 400);
});

await check("rejects a non-uuid playlist id", async () => {
  const res = await alice.call("/api/playlists/not-a-uuid", { method: "DELETE" });
  assert.equal(res.status, 400);
});

await check("rejects a bpm outside the sane range", async () => {
  const res = await alice.call("/api/track-meta", {
    method: "PUT",
    body: { entries: [{ clipKey: "1:aaaaaaaaaaa", bpm: 9000, bpmSource: "tap" }] },
  });
  assert.equal(res.status, 400);
});

await check("rejects a bpm with no source", async () => {
  const res = await alice.call("/api/track-meta", {
    method: "PUT",
    body: { entries: [{ clipKey: "1:aaaaaaaaaaa", bpm: 128 }] },
  });
  assert.equal(
    res.status,
    400,
    "a sourceless reading would bypass the precedence rules",
  );
});

console.log("\nBPM catalogue precedence");

const KEY_A = "2001:ddddddddddd";

async function putMeta(entry) {
  const res = await alice.call("/api/track-meta", {
    method: "PUT",
    body: { entries: [entry] },
  });
  assert.equal(res.status, 200, `write failed: ${res.raw}`);
}

async function readBpm(clipKey) {
  const res = await alice.call("/api/track-meta");
  assert.equal(res.status, 200);
  return res.body.entries.find((e) => e.clipKey === clipKey) ?? null;
}

await check("an automatic reading is stored", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 128, bpmSource: "auto", bpmConfidence: 0.6 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 128);
  assert.equal(row?.bpmSource, "auto");
});

await check("a stronger automatic reading replaces a weaker one", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 130, bpmSource: "auto", bpmConfidence: 0.9 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 130);
});

await check("a weaker automatic reading does not", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 99, bpmSource: "auto", bpmConfidence: 0.2 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 130, "a low-confidence detection overwrote a better one");
});

await check("a tap overrides any detection", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 124, bpmSource: "tap", bpmConfidence: 0.8 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 124);
  assert.equal(row?.bpmSource, "tap");
});

await check("a later detection cannot overwrite a tap", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 175, bpmSource: "auto", bpmConfidence: 1 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 124, "the detector clobbered a human-tapped value");
  assert.equal(row?.bpmSource, "tap");
});

await check("a manual correction still wins", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 62, bpmSource: "manual", bpmConfidence: 1 });
  const row = await readBpm(KEY_A);
  assert.equal(row?.bpm, 62);
});

await check("another user's catalogue is separate", async () => {
  await putMeta({ clipKey: KEY_A, bpm: 62, bpmSource: "manual", bpmConfidence: 1 });
  const res = await mallory.call("/api/track-meta");
  assert.equal(res.status, 200);
  assert.ok(
    !res.body.entries.some((e) => e.clipKey === KEY_A),
    "BPM catalogue leaked between users",
  );
});

console.log("\ninsights guards");

await check("analysing an empty playlist is refused", async () => {
  const created = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "Empty" },
  });
  const res = await alice.call("/api/insights", {
    method: "POST",
    body: {
      playlistId: created.body.playlist.id,
      refresh: false,
      seeds: [],
      ownedReleaseIds: [],
      wantlistReleaseIds: [],
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body?.error?.code, "empty");
  await alice.call(`/api/playlists/${created.body.playlist.id}`, { method: "DELETE" });
});

await check("seeds for releases outside the playlist are ignored", async () => {
  const res = await alice.call("/api/insights", {
    method: "POST",
    body: {
      playlistId: alicePlaylistId,
      refresh: false,
      // None of these release ids are in the playlist.
      seeds: [
        {
          releaseId: 999999,
          artistIds: [1],
          artistNames: ["Injected"],
          labelIds: [1],
          labelNames: ["Injected"],
          styles: [],
          genres: [],
          country: null,
          year: 2020,
        },
      ],
      ownedReleaseIds: [],
      wantlistReleaseIds: [],
    },
  });
  // With every seed filtered out there is nothing to profile, so the request
  // is refused rather than analysed on attacker-chosen metadata.
  assert.equal(res.status, 409);
  assert.equal(res.body?.error?.code, "no_metadata");
});


console.log("\nplaylist privacy");

await check("playlists are created private by default", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "Privacy check" },
  });
  assert.equal(res.status, 201);
  assert.equal(
    res.body.playlist.visibility,
    "private",
    "a playlist must never default to anything but private",
  );
  await alice.call(`/api/playlists/${res.body.playlist.id}`, { method: "DELETE" });
});

await check("visibility cannot be set from the client", async () => {
  const res = await alice.call("/api/playlists", {
    method: "POST",
    body: { name: "Sneaky", visibility: "public" },
  });
  assert.equal(
    res.status,
    400,
    "strict schema must reject an attempt to set visibility",
  );
});

await check("visibility cannot be patched from the client", async () => {
  const res = await alice.call(`/api/playlists/${alicePlaylistId}`, {
    method: "PATCH",
    body: { visibility: "unlisted" },
  });
  assert.equal(res.status, 400);
});

await check("there is no public playlist route", async () => {
  // A share endpoint would be the obvious place for a leak. There isn't one.
  for (const path of [
    `/api/playlists/${alicePlaylistId}/public`,
    `/api/playlists/${alicePlaylistId}/share`,
    `/api/public/playlists/${alicePlaylistId}`,
  ]) {
    const response = await fetch(`${BASE}${path}`);
    assert.ok(
      response.status === 404 || response.status === 405,
      `${path} unexpectedly responded ${response.status}`,
    );
  }
});

console.log("\nwantlist writes");

await check("wantlist add requires authentication", async () => {
  const res = await alice.call("/api/wantlist", {
    method: "PUT",
    body: { releaseId: 12345 },
    cookie: "",
  });
  assert.equal(res.status, 401);
});

await check("wantlist add requires a CSRF token", async () => {
  const res = await alice.call("/api/wantlist", {
    method: "PUT",
    body: { releaseId: 12345 },
    csrfToken: null,
  });
  assert.equal(res.status, 403);
});

await check("wantlist rejects a non-numeric release id", async () => {
  const res = await alice.call("/api/wantlist", {
    method: "PUT",
    body: { releaseId: "not-a-number" },
  });
  assert.equal(res.status, 400);
});

await check("wantlist rejects an unknown property", async () => {
  const res = await alice.call("/api/wantlist", {
    method: "PUT",
    body: { releaseId: 123, username: "someone-else" },
  });
  assert.equal(
    res.status,
    400,
    "a client must not be able to name the account it writes to",
  );
});

console.log("\ndig endpoint");

await check("dig requires authentication", async () => {
  const res = await alice.call("/api/dig", {
    method: "POST",
    body: { seed: { releaseId: 1 } },
    cookie: "",
  });
  assert.equal(res.status, 401);
});

await check("dig requires a CSRF token", async () => {
  const res = await alice.call("/api/dig", {
    method: "POST",
    body: { seed: { releaseId: 1 } },
    csrfToken: null,
  });
  assert.equal(res.status, 403);
});

await check("dig rejects an oversized exclude list", async () => {
  const res = await alice.call("/api/dig", {
    method: "POST",
    body: {
      seed: { releaseId: 1 },
      excludeReleaseIds: Array.from({ length: 20_001 }, (_, i) => i + 1),
    },
  });
  assert.equal(res.status, 400);
});

await check("dig rejects an unknown property", async () => {
  const res = await alice.call("/api/dig", {
    method: "POST",
    body: { seed: { releaseId: 1 }, username: "someone-else" },
  });
  assert.equal(res.status, 400);
});

console.log("\ncleanup");

await check("delete removes the playlist", async () => {
  const res = await alice.call(`/api/playlists/${alicePlaylistId}`, {
    method: "DELETE",
  });
  assert.equal(res.status, 200);
  const after = await alice.call(`/api/playlists/${alicePlaylistId}`);
  assert.equal(after.status, 404);
});

console.log(
  failures === 0
    ? `\nAll ${ran} API tests passed.\n`
    : `\n${failures} of ${ran} API tests failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
