/**
 * Prove your Discogs credentials work, before anything else can confuse you.
 *
 *   node scripts/verify-discogs.mjs .env.local
 *
 * Signs a real OAuth 1.0a request-token call with the key and secret in your
 * env file. If Discogs issues a token, your credentials and your clock are
 * both fine and any later sign-in failure is a callback-URL or origin problem
 * — which is a completely different thing to debug.
 *
 * Uses only node:crypto, so it runs before `npm install`. It prints PASS/FAIL
 * and lengths, never the credentials themselves, and redacts them from any
 * error body Discogs returns.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const envPath = process.argv[2] ?? ".env.local";

const env = {};
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
} catch {
  console.log(`FAIL — could not read ${envPath}`);
  process.exit(1);
}

const key = env.DISCOGS_CONSUMER_KEY;
const secret = env.DISCOGS_CONSUMER_SECRET;
if (!key || !secret) {
  console.log("FAIL — DISCOGS_CONSUMER_KEY or DISCOGS_CONSUMER_SECRET is empty.");
  process.exit(1);
}

// RFC 5849 percent-encoding: stricter than encodeURIComponent.
const enc = (s) =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

const url = "https://api.discogs.com/oauth/request_token";
const callback = (env.APP_ORIGIN ?? "http://localhost:3000") + "/api/auth/callback";

const params = {
  oauth_consumer_key: key,
  oauth_nonce: randomBytes(16).toString("hex"),
  oauth_signature_method: "HMAC-SHA1",
  oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  oauth_version: "1.0",
  oauth_callback: callback,
};

const base = [
  "GET",
  enc(url),
  enc(Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&")),
].join("&");

// No token secret yet at this step, hence the trailing "&".
params.oauth_signature = createHmac("sha1", `${enc(secret)}&`).update(base).digest("base64");

const authorization =
  "OAuth " + Object.keys(params).map((k) => `${enc(k)}="${enc(params[k])}"`).join(", ");

const redact = (s) => s.split(key).join("<key>").split(secret).join("<secret>");

let response;
try {
  response = await fetch(url, {
    headers: {
      Authorization: authorization,
      "User-Agent": `Gemtopia/0.1 ${env.DISCOGS_CONTACT ?? "+https://github.com/titomazzetta/gemtopia"}`,
    },
  });
} catch (error) {
  console.log("FAIL — could not reach api.discogs.com.");
  console.log("       " + String(error.cause?.code ?? error.message));
  process.exit(1);
}

const body = await response.text();

if (response.ok && body.includes("oauth_token=")) {
  console.log("PASS — Discogs accepted the signature and issued a request token.");
  console.log(`       key ${key.length} chars, secret ${secret.length} chars`);
  console.log(`       callback sent: ${callback}`);
  process.exit(0);
}

console.log(`FAIL — HTTP ${response.status}`);
console.log("       " + redact(body.slice(0, 300)).replace(/\n/g, "\n       "));
if (response.status === 401) {
  console.log();
  console.log("  401 almost always means the key/secret pair is wrong or truncated.");
  console.log("  It can also mean your system clock is off by more than a few minutes,");
  console.log("  because the signature covers a timestamp.");
}
process.exit(1);
