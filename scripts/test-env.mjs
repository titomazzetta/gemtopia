/**
 * Environment contract tests.
 *
 *   node --experimental-strip-types scripts/test-env.mjs
 *
 * These exist because of a bug that reached a user on their first run: every
 * optional field rejected a present-but-blank value, so a `.env.local` copied
 * straight from `.env.example` — which is what the docs tell you to do —
 * refused to boot with "ANTHROPIC_API_KEY: String must contain at least 10
 * character(s)". The app had no coverage of its own configuration.
 */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { parseEnv, withoutBlanks } from "../src/lib/env-schema.ts";

let ran = 0;
let failed = 0;

function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message.split("\n").join("\n      ")}`);
  }
}

const SECRET = randomBytes(32).toString("base64url");

/** A complete, valid environment. Tests clone and perturb this. */
const base = () => ({
  DISCOGS_CONSUMER_KEY: "abcdefghij1234567890",
  DISCOGS_CONSUMER_SECRET: "abcdefghij1234567890abcdefghij12",
  SESSION_SECRET: SECRET,
  APP_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgresql://u:p@ep-x-pooler.us-east-1.aws.neon.tech/gemtopia?sslmode=require",
  NODE_ENV: "test",
});

const throws = (raw, matcher) =>
  assert.throws(() => parseEnv(raw), matcher instanceof RegExp ? matcher : { message: matcher });

/* -- the baseline ------------------------------------------------------- */

check("a complete environment parses", () => {
  const env = parseEnv(base());
  assert.equal(env.APP_ORIGIN, "http://localhost:3000");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

check("defaults are applied", () => {
  const env = parseEnv(base());
  assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
  assert.equal(env.LLM_DAILY_OUTPUT_TOKEN_BUDGET, 40000);
  assert.equal(env.DISCOGS_CONTACT, "+https://github.com/");
});

check("result is frozen", () => {
  const env = parseEnv(base());
  assert.throws(() => {
    env.SESSION_SECRET = "tampered";
  });
});

/* -- blank means absent: the bug this file was written for --------------- */

check("blank ANTHROPIC_API_KEY is absent, not invalid", () => {
  const env = parseEnv({ ...base(), ANTHROPIC_API_KEY: "" });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

check("whitespace-only ANTHROPIC_API_KEY is absent too", () => {
  const env = parseEnv({ ...base(), ANTHROPIC_API_KEY: "   " });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

check("blank ANTHROPIC_MODEL falls back to the default", () => {
  const env = parseEnv({ ...base(), ANTHROPIC_MODEL: "" });
  assert.equal(env.ANTHROPIC_MODEL, "claude-sonnet-4-5");
});

check("blank DISCOGS_CONTACT falls back to the default", () => {
  const env = parseEnv({ ...base(), DISCOGS_CONTACT: "" });
  assert.equal(env.DISCOGS_CONTACT, "+https://github.com/");
});

check("blank token budget falls back to 40000, not 0", () => {
  // z.coerce.number() turns "" into 0, which .positive() then rejects.
  // Worse, had .positive() been absent it would have silently disabled the LLM.
  const env = parseEnv({ ...base(), LLM_DAILY_OUTPUT_TOKEN_BUDGET: "" });
  assert.equal(env.LLM_DAILY_OUTPUT_TOKEN_BUDGET, 40000);
});

check("a whole .env.example-shaped file parses", () => {
  // Every optional key present and blank — exactly what `cp .env.example
  // .env.local` plus filling in the required values produces.
  const env = parseEnv({
    ...base(),
    DISCOGS_CONTACT: "",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "",
    LLM_DAILY_OUTPUT_TOKEN_BUDGET: "",
  });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.LLM_DAILY_OUTPUT_TOKEN_BUDGET, 40000);
});

check("a real ANTHROPIC_API_KEY is still kept", () => {
  const env = parseEnv({ ...base(), ANTHROPIC_API_KEY: "sk-ant-0123456789" });
  assert.equal(env.ANTHROPIC_API_KEY, "sk-ant-0123456789");
});

check("a too-short ANTHROPIC_API_KEY is still an error", () => {
  // Blank is absent; present-but-wrong must not be silently discarded.
  throws({ ...base(), ANTHROPIC_API_KEY: "sk-ant" }, /ANTHROPIC_API_KEY/);
});

/* -- required fields ----------------------------------------------------- */

for (const key of [
  "DISCOGS_CONSUMER_KEY",
  "DISCOGS_CONSUMER_SECRET",
  "SESSION_SECRET",
  "APP_ORIGIN",
  "DATABASE_URL",
]) {
  check(`missing ${key} is reported by name`, () => {
    const raw = base();
    delete raw[key];
    throws(raw, new RegExp(key));
  });

  check(`blank ${key} is reported by name, not swallowed`, () => {
    throws({ ...base(), [key]: "" }, new RegExp(key));
  });
}

check("all problems are reported at once", () => {
  const raw = base();
  delete raw.DATABASE_URL;
  delete raw.APP_ORIGIN;
  try {
    parseEnv(raw);
    assert.fail("should have thrown");
  } catch (error) {
    assert.match(error.message, /DATABASE_URL/);
    assert.match(error.message, /APP_ORIGIN/);
  }
});

/* -- individual field rules ---------------------------------------------- */

check("SESSION_SECRET must decode to 32 bytes", () => {
  throws({ ...base(), SESSION_SECRET: randomBytes(16).toString("base64url") }, /32 bytes/);
});

check("SESSION_SECRET of the right length but wrong decode is rejected", () => {
  throws({ ...base(), SESSION_SECRET: "!".repeat(43) }, /SESSION_SECRET/);
});

check("APP_ORIGIN must be absolute", () => {
  // new URL("localhost:3000") parses — scheme "localhost:", path "3000" — so
  // z.string().url() alone lets this through. It must be caught explicitly.
  throws({ ...base(), APP_ORIGIN: "localhost:3000" }, /http:\/\/ or https:\/\//);
});

check("APP_ORIGIN rejects a non-http scheme", () => {
  throws({ ...base(), APP_ORIGIN: "ftp://gemtopia.example" }, /http:\/\/ or https:\/\//);
});

check("APP_ORIGIN rejects an origin with a path", () => {
  // The callback is built relative to this; a path would be silently dropped.
  throws({ ...base(), APP_ORIGIN: "https://example.com/gemtopia" }, /no path/);
});

check("APP_ORIGIN must not have a trailing slash", () => {
  // The callback is built by string join; a trailing slash yields a URL that
  // will not match what Discogs redirects to, and the Origin check compares
  // against this value verbatim.
  throws({ ...base(), APP_ORIGIN: "https://gemtopia.vercel.app/" }, /trailing slash/);
});

check("a production-shaped APP_ORIGIN is fine", () => {
  const env = parseEnv({ ...base(), APP_ORIGIN: "https://gemtopia.vercel.app" });
  assert.equal(env.APP_ORIGIN, "https://gemtopia.vercel.app");
});

check("DATABASE_URL must be a postgres URL", () => {
  throws({ ...base(), DATABASE_URL: "mysql://u:p@host/db" }, /postgres/);
});

check("both postgres:// and postgresql:// are accepted", () => {
  assert.ok(parseEnv({ ...base(), DATABASE_URL: "postgres://u:p@h/d" }));
  assert.ok(parseEnv({ ...base(), DATABASE_URL: "postgresql://u:p@h/d" }));
});

check("a short consumer key is rejected", () => {
  throws({ ...base(), DISCOGS_CONSUMER_KEY: "abc" }, /DISCOGS_CONSUMER_KEY/);
});

check("the real Discogs key length (20) is accepted", () => {
  // Verified against a live application: keys are 20 chars, secrets 32.
  const env = parseEnv({
    ...base(),
    DISCOGS_CONSUMER_KEY: "a".repeat(20),
    DISCOGS_CONSUMER_SECRET: "b".repeat(32),
  });
  assert.equal(env.DISCOGS_CONSUMER_KEY.length, 20);
  assert.equal(env.DISCOGS_CONSUMER_SECRET.length, 32);
});

check("NODE_ENV rejects nonsense", () => {
  throws({ ...base(), NODE_ENV: "staging" }, /NODE_ENV/);
});

/* -- withoutBlanks itself ------------------------------------------------ */

check("withoutBlanks drops blank and undefined, keeps everything else", () => {
  const out = withoutBlanks({ a: "x", b: "", c: "   ", d: undefined, e: "0" });
  assert.deepEqual(out, { a: "x", e: "0" });
});

check("withoutBlanks keeps a value that is only meaningful as a string", () => {
  const out = withoutBlanks({ FLAG: "false" });
  assert.equal(out.FLAG, "false");
});

/* ------------------------------------------------------------------------ */

if (failed > 0) {
  console.error(`\n${failed} of ${ran} env tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} env tests passed.`);
