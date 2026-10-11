/**
 * Database TLS policy tests.   npm run test:db-tls
 *
 * src/lib/dbTls.ts decides how the app connects to Postgres. These pin the
 * three bugs it replaced — a substring test on the URL, a connection
 * string's sslmode quietly overriding the code, and a channel_binding=require
 * the driver never read — and the policy itself.
 */
import assert from "node:assert/strict";
import pg from "pg";
import { isLoopbackHost, pgConnectionOptions } from "../src/lib/dbTls.ts";

let ran = 0;
let failed = 0;
function check(name, fn) {
  ran += 1;
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
  }
}

const NEON = "postgresql://user:pw@ep-cool-dawn-12345-pooler.us-east-1.aws.neon.tech/neondb";
const VERIFIED = { rejectUnauthorized: true, minVersion: "TLSv1.2" };

check("a remote database gets verified TLS and channel binding", () => {
  const o = pgConnectionOptions(`${NEON}?sslmode=require&channel_binding=require`);
  assert.deepEqual(o.ssl, VERIFIED);
  assert.equal(o.enableChannelBinding, true);
});

check("loopback databases connect without TLS (it never leaves the machine)", () => {
  for (const url of [
    "postgresql://postgres:postgres@127.0.0.1:5432/gemtopia_ci",
    "postgresql://postgres@localhost/gemtopia",
    "postgresql://postgres@[::1]:5432/gemtopia",
    "postgresql://postgres@127.0.0.2/gemtopia",
  ]) {
    const o = pgConnectionOptions(url);
    assert.equal(o.ssl, false, url);
    assert.equal(o.enableChannelBinding, false, url);
  }
});

check("the old substring bug: a remote host *containing* 'localhost' still gets TLS", () => {
  assert.deepEqual(pgConnectionOptions("postgresql://u:p@localhost.attacker.example/db").ssl, VERIFIED);
  assert.deepEqual(pgConnectionOptions("postgresql://u:p@127.0.0.1.nip.io/db").ssl, VERIFIED);
});

check("the old substring bug: a password containing '127.0.0.1' doesn't switch TLS off", () => {
  assert.deepEqual(pgConnectionOptions(`postgresql://user:my127.0.0.1pass@db.example.com/x`).ssl, VERIFIED);
  assert.deepEqual(pgConnectionOptions(`postgresql://localhost:pw@db.example.com/x`).ssl, VERIFIED);
});

check("the URL can't weaken it: sslmode=disable / no-verify / libpq-compat are stripped", () => {
  for (const params of [
    "sslmode=disable",
    "sslmode=no-verify",
    "sslmode=prefer",
    "uselibpqcompat=true&sslmode=require",
    "ssl=0",
    "ssl=false&sslmode=allow",
  ]) {
    const o = pgConnectionOptions(`${NEON}?${params}`);
    assert.deepEqual(o.ssl, VERIFIED, params);
    assert.doesNotMatch(o.connectionString, /ssl|uselibpqcompat/i, params);
  }
});

check("what pg actually ends up with: our policy, not the string's", () => {
  // pg merges settings parsed from the connection string OVER the ones in
  // code. With the SSL parameters stripped, ours are the only ones left.
  for (const params of ["sslmode=disable", "sslmode=no-verify", "uselibpqcompat=true&sslmode=require"]) {
    const client = new pg.Client(pgConnectionOptions(`${NEON}?${params}`));
    assert.equal(client.ssl.rejectUnauthorized, true, params);
    assert.equal(client.ssl.minVersion, "TLSv1.2", params);
    assert.equal(client.enableChannelBinding, true, params);
  }
  // And the bug being fixed: without the policy, the string wins.
  const naive = new pg.Client({ connectionString: `${NEON}?sslmode=disable`, ssl: { rejectUnauthorized: true } });
  assert.equal(naive.ssl, false);
});

check("channel_binding=require in the URL does nothing in pg; the policy is what turns binding on", () => {
  // Neon's console strings end in sslmode=require&channel_binding=require.
  // node-postgres doesn't read channel_binding at all — it binds only when
  // enableChannelBinding is set in code — so the URL alone never bound.
  const url = `${NEON}?sslmode=require&channel_binding=require`;
  assert.equal(new pg.Client({ connectionString: url }).enableChannelBinding, false);
  assert.equal(new pg.Client(pgConnectionOptions(url)).enableChannelBinding, true);
});

check("other parameters survive byte for byte (no + for %20 re-encoding)", () => {
  const o = pgConnectionOptions(`${NEON}?sslmode=require&options=-c%20search_path%3Dpublic&application_name=gemtopia`);
  assert.equal(o.connectionString, `${NEON}?options=-c%20search_path%3Dpublic&application_name=gemtopia`);
});

check("?host= is honoured the way pg honours it", () => {
  assert.equal(pgConnectionOptions("postgresql://u:p@db.example.com/x?host=localhost").ssl, false);
  assert.deepEqual(pgConnectionOptions("postgresql://u:p@localhost/x?host=db.example.com").ssl, VERIFIED);
  assert.equal(pgConnectionOptions("postgresql:///x?host=/var/run/postgresql").ssl, false);
});

check("not a postgres URL, or no host at all, is refused", () => {
  assert.throws(() => pgConnectionOptions("mysql://u:p@db.example.com/x"), /postgres/);
  assert.throws(() => pgConnectionOptions("not a url"), /not a URL/);
  assert.throws(() => pgConnectionOptions("postgresql:///gemtopia"), /no host/);
});

check("isLoopbackHost is exact", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("LOCALHOST"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("localhost.example.com"), false);
  assert.equal(isLoopbackHost("127.0.0.1.example.com"), false);
  assert.equal(isLoopbackHost("10.0.0.1"), false);
});

if (failed > 0) {
  console.error(`\n${failed} of ${ran} database TLS tests failed.`);
  process.exit(1);
}
console.log(`All ${ran} database TLS tests passed.`);
