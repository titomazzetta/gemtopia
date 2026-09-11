#!/usr/bin/env node
/**
 * Check a Postgres connection string before trusting it.
 *
 *   node scripts/verify-db.mjs              check only
 *   node scripts/verify-db.mjs --migrate    check, then apply db/schema.sql
 *   node scripts/verify-db.mjs --copy       check, then put the corrected
 *                                           string on the clipboard
 *
 * Companion to verify-discogs.mjs, and written for the same reason: a bad
 * value here does not fail the build. `next build` never opens a connection,
 * so a wrong DATABASE_URL sails through deployment and only surfaces as a
 * confusing error the first time somebody signs in.
 *
 * Prints the shape of the string and never the password — only its length.
 * Paste at the prompt; nothing is echoed and nothing reaches shell history.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import pg from "pg";

// Tolerate a trailing slash — shells tab-complete one onto flags often
// enough that a silent "did nothing" is a worse outcome than being lenient.
const COPY = process.argv.some((arg) => arg.replace(/\/+$/, "") === "--copy");
const MIGRATE = process.argv.some((arg) => arg.replace(/\/+$/, "") === "--migrate");
const here = dirname(fileURLToPath(import.meta.url));

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    let muted = false;
    rl._writeToOutput = (chunk) => {
      if (!muted) rl.output.write(chunk);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

const raw = process.env.DATABASE_URL ?? (await askHidden("Paste the connection string: "));

if (!raw) {
  console.log("Nothing entered.");
  process.exit(1);
}

console.log(`\nlength    : ${raw.length}`);

let url;
try {
  url = new URL(raw);
} catch (error) {
  console.log(`NOT A URL : ${error.message}`);
  console.log(`starts    : ${JSON.stringify(raw.slice(0, 24))}`);
  console.log("\nThat is not a connection string. In Neon use Connect → the");
  console.log("'Connection string' tab (not psql, not a framework snippet).");
  process.exit(1);
}

const pooled = url.hostname.includes("-pooler");
const scheme = url.protocol === "postgres:" || url.protocol === "postgresql:";

console.log(`protocol  : ${url.protocol}${scheme ? "" : "   <-- must be postgresql:"}`);
console.log(`hostname  : ${url.hostname}`);
console.log(`pooled    : ${pooled ? "yes" : "NO  <-- serverless needs the -pooler host"}`);
console.log(`database  : ${url.pathname.replace(/^\//, "") || "(none)"}`);
console.log(`params    : ${url.search || "(none)"}`);
console.log(`username  : ${url.username ? "set" : "MISSING"}`);
console.log(`password  : ${url.password ? `${url.password.length} chars` : "MISSING"}`);

if (!scheme || !url.username || !url.password) {
  console.log("\nThe string is malformed — stopping before trying to connect.");
  process.exit(1);
}

/*
 * `sslmode=require` is treated as `verify-full` by pg today but will weaken to
 * libpq semantics in pg v9. Normalising here means the string you verify is
 * byte-for-byte the string that should go into Vercel — no hand-editing a
 * 148-character line and hoping you changed the right `require`.
 */
const connectionString = raw.replace("sslmode=require", "sslmode=verify-full");
if (connectionString !== raw) {
  console.log("sslmode   : rewritten require -> verify-full");
}

console.log("\nConnecting…");
const client = new pg.Client({ connectionString });
try {
  await client.connect();
  const { rows: [info] } = await client.query("select version(), current_database() as db");
  const { rows: tables } = await client.query(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  );
  console.log(`PASS      : connected to "${info.db}"`);
  console.log(`server    : ${info.version.split(" ").slice(0, 2).join(" ")}`);
  if (tables.length === 0) {
    console.log("tables    : none — this database has not been migrated yet");
  } else {
    console.log(`tables    : ${tables.map((t) => t.tablename).join(", ")}`);
  }

  if (MIGRATE) {
    // db/schema.sql is idempotent — every statement is CREATE ... IF NOT
    // EXISTS — so running this against an already-migrated database is a
    // no-op rather than a mistake.
    console.log("\nApplying db/schema.sql…");
    await client.query(readFileSync(join(here, "..", "db", "schema.sql"), "utf8"));
    const { rows: after } = await client.query(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    console.log("MIGRATED  : tables now present:");
    for (const row of after) console.log(`  - ${row.tablename}`);
  } else if (tables.length === 0) {
    console.log("\nRun again with --migrate to create them.");
  }
} catch (error) {
  console.log(`FAIL      : ${error.message}`);
  if (String(error.message).includes("ENOTFOUND")) {
    console.log("            The hostname above does not resolve. Re-copy from Neon.");
  }
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

/*
 * Hand the corrected string straight to the clipboard.
 *
 * The value Vercel needs differs from what Neon hands you by exactly one
 * parameter, and editing 148 characters by hand — then pasting them into a
 * write-only field you can never read back — is how a deployment ends up
 * pointing at nothing. Copying happens only after a successful connection, so
 * what lands on the clipboard is a string that has been proven to work.
 */
if (COPY && process.exitCode !== 1) {
  if (process.platform !== "darwin") {
    console.log("\n--copy needs macOS (pbcopy). Edit sslmode=require -> verify-full by hand.");
  } else {
    execFileSync("pbcopy", { input: connectionString });
    console.log("\nCOPIED    : the verified string is on your clipboard.");
    console.log("            Paste it into Vercel as DATABASE_URL, then redeploy.");
  }
}
